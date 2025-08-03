import {AbiCoder, Contract, JsonRpcProvider, Signer, TransactionRequest, Wallet as PKWallet} from 'ethers'
import Sdk from '@1inch/cross-chain-sdk'
import { createPublicClient, createWalletClient, http, getContract, parseAbi, type PublicClient, type WalletClient, type Chain, erc20Abi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { clientToProvider, createEthersProvider, createViemPublicClient, createViemWalletClient } from './ethers'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

// Get RPC URL from environment
const DEFAULT_RPC_URL = process.env.SRC_CHAIN_RPC || 'https://g.w.lavanet.xyz:443/gateway/sep1/rpc-http/d3630392db153e71701cd89c262c116e'

const coder = AbiCoder.defaultAbiCoder()

export class Wallet {
    public provider: JsonRpcProvider
    public signer: Signer
    public viemPublicClient: PublicClient
    public viemWalletClient: WalletClient | null = null
    private privateKey: string | null = null
    private chain: Chain

    constructor(privateKeyOrSigner: string | Signer, provider: JsonRpcProvider, chain?: Chain) {
        this.provider = provider
        this.signer =
            typeof privateKeyOrSigner === 'string'
                ? new PKWallet(privateKeyOrSigner, this.provider)
                : privateKeyOrSigner
        
        // Store private key if provided for viem operations
        if (typeof privateKeyOrSigner === 'string') {
            this.privateKey = privateKeyOrSigner
        }
        
        // Always use Sepolia RPC URL
        const rpcUrl = DEFAULT_RPC_URL
        console.log('Wallet using RPC URL:', rpcUrl)
        
        // Configure chain for Sepolia
        this.chain = chain || {
            id: 11155111, // Sepolia
            name: 'Sepolia',
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls: { default: { http: [rpcUrl] } }
        }
        
        // Create viem clients
        this.viemPublicClient = createPublicClient({
            chain: this.chain,
            transport: http(rpcUrl)
        })
        
        if (this.privateKey) {
            const account = privateKeyToAccount(this.privateKey as `0x${string}`)
            this.viemWalletClient = createWalletClient({
                account,
                chain: this.chain,
                transport: http(rpcUrl)
            })
        }
    }

    public static async fromAddress(address: string, provider: JsonRpcProvider, chain?: Chain): Promise<Wallet> {
        // Create a read-only wallet for the specified address without anvil impersonation
        // This creates a JSON-RPC account that can be used for read operations and balance checks
        const signer = await provider.getSigner(address.toString())

        return new Wallet(signer, provider, chain)
    }

    public static async fromAddressReadOnly(address: string, provider: JsonRpcProvider, chain?: Chain): Promise<Wallet> {
        // Alternative method that creates a wallet instance for read-only operations
        // without requiring anvil impersonation - useful for RPC-only setups
        
        // Create a mock signer that only supports address retrieval
        const mockSigner = {
            getAddress: () => Promise.resolve(address),
            // Add other required signer methods as no-ops or throw errors for write operations
            signTransaction: () => { throw new Error('Read-only wallet cannot sign transactions') },
            signMessage: () => { throw new Error('Read-only wallet cannot sign messages') },
            connect: (provider: any) => mockSigner,
            provider: provider
        } as any

        return new Wallet(mockSigner, provider, chain)
    }

    static async tokenBalance(viemPublicClient: PublicClient, address: string, token: string): Promise<bigint> {
        // Use viem for better performance and type safety
        const balance = await viemPublicClient.readContract({
            address: token as `0x${string}`,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [address  as `0x${string}`]
        })
        
        return balance
    }

    async topUpFromDonor(token: string, donor: string, amount: bigint): Promise<void> {
        const donorWallet = await Wallet.fromAddress(donor, this.provider)
        await donorWallet.transferToken(token, await this.getAddress(), amount)
    }

    public async getAddress(): Promise<string> {
        return this.signer.getAddress()
    }

    public async unlimitedApprove(tokenAddress: string, spender: string): Promise<void> {
        const currentApprove = await this.getAllowance(tokenAddress, spender)

        // for usdt like tokens
        if (currentApprove !== 0n) {
            await this.approveToken(tokenAddress, spender, 0n)
        }

        await this.approveToken(tokenAddress, spender, (1n << 256n) - 1n)
    }

    public async getAllowance(token: string, spender: string): Promise<bigint> {
        // Use viem for better performance and type safety
        const allowance = await this.viemPublicClient.readContract({
            address: token as `0x${string}`,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [await this.getAddress() as `0x${string}`, spender as `0x${string}`]
        })
        
        return allowance
    }

    public async transfer(dest: string, amount: bigint): Promise<void> {
        if (!this.viemWalletClient) {
            throw new Error('Wallet client not available')
        }

        console.log(`[WALLET] Transferring ${amount} ETH from ${this.viemWalletClient.account?.address} to ${dest}`)
        
        // Use viem for ETH transfers
        const hash = await this.viemWalletClient.sendTransaction({
            account: this.viemWalletClient.account!,
            to: dest as `0x${string}`,
            value: amount,
            chain: this.chain
        })// Wait for transaction confirmation
        await this.viemPublicClient.waitForTransactionReceipt({ hash })
    }

    public async transferToken(token: string, dest: string, amount: bigint): Promise<void> {
        if (!this.viemWalletClient) {
            throw new Error('Wallet client not available')
        }

        console.log(`[WALLET] Transferring ${amount} tokens from ${this.viemWalletClient.account?.address} to ${dest}`)
        
        // Use viem for better performance and type safety
        const hash = await this.viemWalletClient.writeContract({
            account: this.viemWalletClient.account!,
            address: token as `0x${string}`,
            abi: erc20Abi,
            functionName: 'transfer',
            args: [dest as `0x${string}`, amount],
            chain: this.chain
        })
        
        console.log(`[WALLET] Transfer transaction hash: ${hash}`)
        
        // Wait for transaction confirmation
        await this.viemPublicClient.waitForTransactionReceipt({ hash })
    }

    public async approveToken(token: string, spender: string, amount: bigint): Promise<void> {
        if (!this.viemWalletClient) {
            throw new Error('Wallet client not available')
        }
        
        // Use viem for better performance and type safety
        const hash = await this.viemWalletClient.writeContract({
            account: this.viemWalletClient.account!,
            address: token as `0x${string}`,
            abi: erc20Abi,
            functionName: 'approve',
            args: [spender as `0x${string}`, amount],
            chain: this.chain
        })
        
        // Wait for transaction confirmation
        await this.viemPublicClient.waitForTransactionReceipt({ hash })
    }

    public async signOrder(srcChainId: number, order: Sdk.CrossChainOrder): Promise<string> {
        const typedData = order.getTypedData(srcChainId)

        return this.signer.signTypedData(
            typedData.domain,
            {Order: typedData.types[typedData.primaryType]},
            typedData.message
        )
    }

    // async send(param: TransactionRequest): Promise<{txHash: string; blockTimestamp: bigint; blockHash: string}> {
    //     if (!this.viemWalletClient) {
    //         throw new Error('Wallet client not available')
    //     }

    //     // Use viem for transaction
    //     const hash = await this.viemWalletClient.sendTransaction({
    //         account: this.viemWalletClient.account!,
    //         to: param.to as `0x${string}`,
    //         value: param.value ? BigInt(param.value.toString()) : 0n,
    //         data: param.data as `0x${string}`,
    //         gas: 500000n,
    //         maxFeePerGas: 20000000000n, // 20 gwei
    //         maxPriorityFeePerGas: 2000000000n, // 2 gwei
    //         chain: this.chain
    //     })
        
    //     const receipt = await this.viemPublicClient.waitForTransactionReceipt({ hash })
    //     const block = await this.viemPublicClient.getBlock({ blockHash: receipt.blockHash })
        
    //     if (receipt.status === 'success') {
    //         return {
    //             txHash: receipt.transactionHash,
    //             blockTimestamp: block.timestamp,
    //             blockHash: receipt.blockHash
    //         }
    //     }
        
    //     throw new Error(`Transaction failed with status: ${receipt.status}`)
    // }

    async send(param: TransactionRequest): Promise<{txHash: string; blockTimestamp: bigint; blockHash: string}> {
        if (!this.viemWalletClient) {
            throw new Error('Wallet client not available')
        }

        // Prepare transaction request manually to force on-chain execution
        const request = await this.viemWalletClient.prepareTransactionRequest({
            account: this.viemWalletClient.account!,
            to: param.to as `0x${string}`,
            value: param.value ? BigInt(param.value.toString()) : 0n,
            data: param.data as `0x${string}`,
            gas: 500000n,
            maxFeePerGas: 20000000000n, // 20 gwei
            maxPriorityFeePerGas: 2000000000n, // 2 gwei
            chain: this.chain
        })

        // Sign the transaction
        const serializedTransaction = await this.viemWalletClient.signTransaction(request)

        // Send raw transaction to force on-chain execution
        const hash = await this.viemWalletClient.sendRawTransaction({ serializedTransaction })
        
        const receipt = await this.viemPublicClient.waitForTransactionReceipt({ hash })
        const block = await this.viemPublicClient.getBlock({ blockHash: receipt.blockHash })
        
        if (receipt.status === 'success') {
            return {
                txHash: receipt.transactionHash,
                blockTimestamp: block.timestamp,
                blockHash: receipt.blockHash
            }
        }
        
        throw new Error(`Transaction failed with status: ${receipt.status}`)
    }
}
