import 'dotenv/config'
import {expect, jest} from '@jest/globals'

import {createServer, CreateServerReturnType} from 'prool'
import {anvil} from 'prool/instances'

import Sdk from '@1inch/cross-chain-sdk'
import {
    computeAddress,
    ContractFactory,
    JsonRpcProvider,
    MaxUint256,
    parseEther,
    parseUnits,
    randomBytes,
    Wallet as SignerWallet
} from 'ethers'
import {uint8ArrayToHex, UINT_40_MAX} from '@1inch/byte-utils'
import assert from 'node:assert'
import {ChainConfig, config} from './config'
import {Wallet} from './wallet'
import {Resolver} from './resolver'
import {EscrowFactory} from './escrow-factory'
import factoryContract from '../dist/contracts/TestEscrowFactory.sol/TestEscrowFactory.json'
import resolverContract from '../dist/contracts/Resolver.sol/Resolver.json'
import {getEthereumConfig, getSuiConfig} from './contract-addresses'
import { createWalletClient, createPublicClient, http, ProviderDisconnectedError} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains'
import type {PublicClient, WalletClient, Account} from 'viem'
import{CONTRACT_ADDRESSES} from './contract-addresses'


const {Address} = Sdk

const TEST_CONFIG = {
    // Ethereum Sepolia configuration
    ethereum: getEthereumConfig('sepolia'),
    // Sui configuration
    sui: getSuiConfig(),
    // API configuration
    /*api: {
        baseUrl: mockBackendUrl,
        authKey: mockAuthKey
    }*/
}

jest.setTimeout(1000 * 120)

const userPk = process.env.USER_PRIVATE_KEY as `0x${string}`
const resolverPk = process.env.RESOLVER_PK as `0x${string}`
const privateKey = process.env.USER_PRIVATE_KEY as `0x${string}`

const account = privateKeyToAccount(privateKey as `0x${string}`)

// Get RPC URL from environment or use default
const rpcUrl = process.env.SEPOLIA_RPC_URL || 'https://g.w.lavanet.xyz:443/gateway/sep1/rpc-http/d3630392db153e71701cd89c262c116e'
        
// Create wallet client with sepolia
const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(rpcUrl)
})

        // Create public client
const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl)
})


// eslint-disable-next-line max-lines-per-function
describe('Resolving example', () => {
    const srcChainId = Sdk.NetworkEnum.ETHEREUM
    //ChainId = config.chain.destination.chainId

    type Chain = {
        node?: CreateServerReturnType | undefined
        provider: PublicClient
        wallet: ReturnType<typeof createWalletClient> // écriture + signatures
        escrowFactory: string
        resolver: string
    }

    let src: Chain
    //let dst: Chain

    let srcChainUser: Wallet
    //let dstChainUser: Wallet
    let srcChainResolver: Wallet
    //let dstChainResolver: Wallet

    let srcFactory: EscrowFactory
    let dstFactory: EscrowFactory
    let srcResolverContract: Wallet
    let dstResolverContract: Wallet

    let srcTimestamp: bigint

    async function increaseTime(t: number): Promise<void> {
        await Promise.all([src].map((chain) => chain.provider.send('evm_increaseTime', [t])))
    }

    beforeAll(async () => {
        console.log('config.chain.source', config.chain.source)
        const {provider, wallet, escrowFactory, resolver} = await initChain(config.chain.source, account, true, CONTRACT_ADDRESSES.sepolia.resolver, CONTRACT_ADDRESSES.sepolia.escrowFactory)
            //initChain(config.chain.destination)

        srcChainUser = new Wallet(userPk, resolver)
        //dstChainUser = new Wallet(userPk, dst.provider)
        srcChainResolver = new Wallet(resolverPk, resolver)
        //dstChainResolver = new Wallet(resolverPk, dst.provider as JsonRpcProvider)*/

        srcFactory = new EscrowFactory(resolver, escrowFactory)
        //dstFactory = new EscrowFactory(dst.provider, dst.escrowFactory)
        // get 1000 USDC for user in SRC chain and approve to LOP
        //console.log('srcChainUser', srcChainUser.getAddress)

        console.log('DONE WITH CREATIONS ?')

        await srcChainUser.approveToken(
            config.chain.source.tokens.USDC.address,
            config.chain.source.limitOrderProtocol,
            MaxUint256
        )

        console.log('DONE WITH approvetoken ????')

        // get 2000 USDC for resolver in DST chain
        srcResolverContract = await Wallet.fromAddress(resolver, provider)
        //dstResolverContract = await Wallet.fromAddress(dst.resolver, dst.provider)
        // top up contract for approve
        //await dstChainResolver.transfer(dst.resolver, parseEther('1'))
        //await dstResolverContract.unlimitedApprove(config.chain.destination.tokens.USDC.address, dst.escrowFactory)

        srcTimestamp = BigInt((await provider.getBlock('latest'))!.timestamp)
        console.log('DONE WITH BEFORE ALL ???')
    })

    async function getBalances(
        srcToken: string,
        //dstToken: string
    ): Promise<{src: {user: bigint; resolver: bigint}}> {
        return {
            src: {
                user: await srcChainUser.tokenBalance(srcToken),
                resolver: await srcResolverContract.tokenBalance(srcToken)
            },
            //dst: {
                //user: await dstChainUser.tokenBalance(dstToken),
                //resolver: await dstResolverContract.tokenBalance(dstToken)
            //}
        }
    }

    afterAll(async () => {
        src.provider.destroy()
        //dst.provider.destroy()
        await Promise.all([src.node?.stop()])//dst.node?.stop()
    })

    // eslint-disable-next-line max-lines-per-function
    describe('Fill', () => {
        it('should swap Ethereum USDC -> Bsc USDC. Single fill only', async () => {
            const initialBalances = await getBalances(
                config.chain.source.tokens.USDC.address,
                //config.chain.destination.tokens.USDC.address
            )

            // User creates order
            const secret = uint8ArrayToHex(randomBytes(32)) // note: use crypto secure random number in real world
            const order = Sdk.CrossChainOrder.new(
                new Address(src.escrowFactory),
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await srcChainUser.getAddress()),
                    makingAmount: parseUnits('100', 6),
                    takingAmount: parseUnits('99', 6),
                    makerAsset: new Address(config.chain.source.tokens.USDC.address),
                    takerAsset: new Address(config.chain.source.tokens.USDC.address)
                },
                {
                    hashLock: Sdk.HashLock.forSingleFill(secret),
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: 10n, // 10sec finality lock for test
                        srcPublicWithdrawal: 120n, // 2m for private withdrawal
                        srcCancellation: 121n, // 1sec public withdrawal
                        srcPublicCancellation: 122n, // 1sec private cancellation
                        dstWithdrawal: 10n, // 10sec finality lock for test
                        dstPublicWithdrawal: 100n, // 100sec private withdrawal
                        dstCancellation: 101n // 1sec public withdrawal
                    }),
                    srcChainId: Sdk.NetworkEnum.ETHEREUM,
                    dstChainId: Sdk.NetworkEnum.POLYGON,
                    srcSafetyDeposit: parseEther('0.001'),
                    dstSafetyDeposit: parseEther('0.001')
                },
                {
                    auction: new Sdk.AuctionDetails({
                        initialRateBump: 0,
                        points: [],
                        duration: 120n,
                        startTime: srcTimestamp
                    }),
                    whitelist: [
                        {
                            address: new Address(src.resolver),
                            allowFrom: 0n
                        }
                    ],
                    resolvingStartTime: 0n
                },
                {
                    nonce: Sdk.randBigInt(UINT_40_MAX),
                    allowPartialFills: false,
                    allowMultipleFills: false
                }
            )

            const signature = await srcChainUser.signOrder(srcChainId, order)
            const orderHash = order.getOrderHash(srcChainId)
            // Resolver fills order
            const resolverContract = new Resolver(src.resolver, src.resolver)

            console.log(`[${srcChainId}]`, `Filling order ${orderHash}`)
            
            const fillAmount = order.makingAmount
            const resolverContractTx = resolverContract.deploySrc(
                srcChainId,
                order,
                signature,
                Sdk.TakerTraits.default()
                    .setExtension(order.extension)
                    .setAmountMode(Sdk.AmountMode.maker)
                    .setAmountThreshold(order.takingAmount),
                fillAmount
            )
            console.log('resolverContractTx', resolverContractTx)
            const {txHash: orderFillHash, blockHash: srcDeployBlock} = await srcChainResolver.send(
                resolverContractTx
            )


            console.log(`[${srcChainId}]`, `Order ${orderHash} filled for ${fillAmount} in tx ${orderFillHash}`)

            const srcEscrowEvent = await srcFactory.getSrcDeployEvent(srcDeployBlock)

            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))

            //console.log(`[${dstChainId}]`, `Depositing ${dstImmutables.amount} for order ${orderHash}`)
            //const {txHash: dstDepositHash, blockTimestamp: dstDeployedAt} = await dstChainResolver.send(
                //resolverContract.deployDst(dstImmutables)
            //)
            //console.log(`[${dstChainId}]`, `Created dst deposit for order ${orderHash} in tx ${dstDepositHash}`)

            const ESCROW_SRC_IMPLEMENTATION = await srcFactory.getSourceImpl()
            //const ESCROW_DST_IMPLEMENTATION = await dstFactory.getDestinationImpl()

            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(src.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                ESCROW_SRC_IMPLEMENTATION
            )

            // const dstEscrowAddress = new Sdk.EscrowFactory(new Address(src.escrowFactory)).getDstEscrowAddress(
            //     srcEscrowEvent[0],
            //     srcEscrowEvent[1],
            //     dstDeployedAt,
            //     new Address(resolverContract.dstAddress),
            //     ESCROW_DST_IMPLEMENTATION
            // )

            await increaseTime(11)
            // User shares key after validation of dst escrow deployment
            // console.log(`[${dstChainId}]`, `Withdrawing funds for user from ${dstEscrowAddress}`)
            // await dstChainResolver.send(
            //     resolverContract.withdraw('dst', dstEscrowAddress, secret, dstImmutables.withDeployedAt(dstDeployedAt))
            // )

            console.log(`[${srcChainId}]`, `Withdrawing funds for resolver from ${srcEscrowAddress}`)
            const {txHash: resolverWithdrawHash} = await srcChainResolver.send(
                resolverContract.withdraw('src', srcEscrowAddress, secret, srcEscrowEvent[0])
            )
            console.log(
                `[${srcChainId}]`,
                `Withdrew funds for resolver from ${srcEscrowAddress} to ${src.resolver} in tx ${resolverWithdrawHash}`
            )

            const resultBalances = await getBalances(
                config.chain.source.tokens.USDC.address,
                //config.chain.destination.tokens.USDC.address
            )

            // user transferred funds to resolver on source chain
            expect(initialBalances.src.user - resultBalances.src.user).toBe(order.makingAmount)
            expect(resultBalances.src.resolver - initialBalances.src.resolver).toBe(order.makingAmount)
            // resolver transferred funds to user on destination chain
            // expect(resultBalances.dst.user - initialBalances.dst.user).toBe(order.takingAmount)
            // expect(initialBalances.dst.resolver - resultBalances.dst.resolver).toBe(order.takingAmount)
        })

        it('should swap Ethereum USDC -> Bsc USDC. Multiple fills. Fill 100%', async () => {
            const initialBalances = await getBalances(
                config.chain.source.tokens.USDC.address,
                //config.chain.destination.tokens.USDC.address
            )

            // User creates order
            // 11 secrets
            const secrets = Array.from({length: 11}).map(() => uint8ArrayToHex(randomBytes(32))) // note: use crypto secure random number in the real world
            const secretHashes = secrets.map((s) => Sdk.HashLock.hashSecret(s))
            const leaves = Sdk.HashLock.getMerkleLeaves(secrets)
            const order = Sdk.CrossChainOrder.new(
                new Address(src.escrowFactory),
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await srcChainUser.getAddress()),
                    makingAmount: parseUnits('100', 6),
                    takingAmount: parseUnits('99', 6),
                    makerAsset: new Address(config.chain.source.tokens.USDC.address),
                    takerAsset: new Address(config.chain.source.tokens.USDC.address)
                },
                {
                    hashLock: Sdk.HashLock.forMultipleFills(leaves),
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: 10n, // 10s finality lock for test
                        srcPublicWithdrawal: 120n, // 2m for private withdrawal
                        srcCancellation: 121n, // 1sec public withdrawal
                        srcPublicCancellation: 122n, // 1sec private cancellation
                        dstWithdrawal: 10n, // 10s finality lock for test
                        dstPublicWithdrawal: 100n, // 100sec private withdrawal
                        dstCancellation: 101n // 1sec public withdrawal
                    }),
                    srcChainId: Sdk.NetworkEnum.ETHEREUM,
                    dstChainId: Sdk.NetworkEnum.POLYGON,
                    srcSafetyDeposit: parseEther('0.001'),
                    dstSafetyDeposit: parseEther('0.001')
                },
                {
                    auction: new Sdk.AuctionDetails({
                        initialRateBump: 0,
                        points: [],
                        duration: 120n,
                        startTime: srcTimestamp
                    }),
                    whitelist: [
                        {
                            address: new Address(src.resolver),
                            allowFrom: 0n
                        }
                    ],
                    resolvingStartTime: 0n
                },
                {
                    nonce: Sdk.randBigInt(UINT_40_MAX),
                    allowPartialFills: true,
                    allowMultipleFills: true
                }
            )

            const signature = await srcChainUser.signOrder(srcChainId, order)
            const orderHash = order.getOrderHash(srcChainId)
            // Resolver fills order
            const resolverContract = new Resolver(src.resolver, src.resolver)

            console.log(`[${srcChainId}]`, `Filling order ${orderHash}`)

            const fillAmount = order.makingAmount
            const idx = secrets.length - 1 // last index to fulfill
            // Number((BigInt(secrets.length - 1) * (fillAmount - 1n)) / order.makingAmount)

            const {txHash: orderFillHash, blockHash: srcDeployBlock} = await srcChainResolver.send(
                resolverContract.deploySrc(
                    srcChainId,
                    order,
                    signature,
                    Sdk.TakerTraits.default()
                        .setExtension(order.extension)
                        .setInteraction(
                            new Sdk.EscrowFactory(new Address(src.escrowFactory)).getMultipleFillInteraction(
                                Sdk.HashLock.getProof(leaves, idx),
                                idx,
                                secretHashes[idx]
                            )
                        )
                        .setAmountMode(Sdk.AmountMode.maker)
                        .setAmountThreshold(order.takingAmount),
                    fillAmount,
                    Sdk.HashLock.fromString(secretHashes[idx])
                )
            )

            console.log(`[${srcChainId}]`, `Order ${orderHash} filled for ${fillAmount} in tx ${orderFillHash}`)

            const srcEscrowEvent = await srcFactory.getSrcDeployEvent(srcDeployBlock)

            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))

            // console.log(`[${dstChainId}]`, `Depositing ${dstImmutables.amount} for order ${orderHash}`)
            // const {txHash: dstDepositHash, blockTimestamp: dstDeployedAt} = await dstChainResolver.send(
            //     resolverContract.deployDst(dstImmutables)
            // )
            // console.log(`[${dstChainId}]`, `Created dst deposit for order ${orderHash} in tx ${dstDepositHash}`)

            const secret = secrets[idx]

            const ESCROW_SRC_IMPLEMENTATION = await srcFactory.getSourceImpl()
            //const ESCROW_DST_IMPLEMENTATION = await dstFactory.getDestinationImpl()

            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(src.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                ESCROW_SRC_IMPLEMENTATION
            )

            // const dstEscrowAddress = new Sdk.EscrowFactory(new Address(dst.escrowFactory)).getDstEscrowAddress(
            //     srcEscrowEvent[0],
            //     srcEscrowEvent[1],
            //     dstDeployedAt,
            //     new Address(resolverContract.dstAddress),
            //     ESCROW_DST_IMPLEMENTATION
            // )

            await increaseTime(11) // finality lock passed
            // User shares key after validation of dst escrow deployment
            // console.log(`[${dstChainId}]`, `Withdrawing funds for user from ${dstEscrowAddress}`)
            // await dstChainResolver.send(
            //     resolverContract.withdraw('dst', dstEscrowAddress, secret, dstImmutables.withDeployedAt(dstDeployedAt))
            // )

            console.log(`[${srcChainId}]`, `Withdrawing funds for resolver from ${srcEscrowAddress}`)
            const {txHash: resolverWithdrawHash} = await srcChainResolver.send(
                resolverContract.withdraw('src', srcEscrowAddress, secret, srcEscrowEvent[0])
            )
            console.log(
                `[${srcChainId}]`,
                `Withdrew funds for resolver from ${srcEscrowAddress} to ${src.resolver} in tx ${resolverWithdrawHash}`
            )

            const resultBalances = await getBalances(
                config.chain.source.tokens.USDC.address,
                //config.chain.destination.tokens.USDC.address
            )

            // user transferred funds to resolver on the source chain
            expect(initialBalances.src.user - resultBalances.src.user).toBe(order.makingAmount)
            expect(resultBalances.src.resolver - initialBalances.src.resolver).toBe(order.makingAmount)
            // resolver transferred funds to user on the destination chain
            // expect(resultBalances.dst.user - initialBalances.dst.user).toBe(order.takingAmount)
            // expect(initialBalances.dst.resolver - resultBalances.dst.resolver).toBe(order.takingAmount)
        })

        it('should swap Ethereum USDC -> Bsc USDC. Multiple fills. Fill 50%', async () => {
            const initialBalances = await getBalances(
                config.chain.source.tokens.USDC.address,
                //config.chain.destination.tokens.USDC.address
            )

            // User creates order
            // 11 secrets
            const secrets = Array.from({length: 11}).map(() => uint8ArrayToHex(randomBytes(32))) // note: use crypto secure random number in the real world
            const secretHashes = secrets.map((s) => Sdk.HashLock.hashSecret(s))
            const leaves = Sdk.HashLock.getMerkleLeaves(secrets)
            const order = Sdk.CrossChainOrder.new(
                new Address(src.escrowFactory),
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await srcChainUser.getAddress()),
                    makingAmount: parseUnits('100', 6),
                    takingAmount: parseUnits('99', 6),
                    makerAsset: new Address(config.chain.source.tokens.USDC.address),
                    takerAsset: new Address(config.chain.source.tokens.USDC.address)
                },
                {
                    hashLock: Sdk.HashLock.forMultipleFills(leaves),
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: 10n, // 10s finality lock for test
                        srcPublicWithdrawal: 120n, // 2m for private withdrawal
                        srcCancellation: 121n, // 1sec public withdrawal
                        srcPublicCancellation: 122n, // 1sec private cancellation
                        dstWithdrawal: 10n, // 10s finality lock for test
                        dstPublicWithdrawal: 100n, // 100sec private withdrawal
                        dstCancellation: 101n // 1sec public withdrawal
                    }),
                    srcChainId: Sdk.NetworkEnum.ETHEREUM,
                    dstChainId: Sdk.NetworkEnum.POLYGON,
                    srcSafetyDeposit: parseEther('0.001'),
                    dstSafetyDeposit: parseEther('0.001')
                },
                {
                    auction: new Sdk.AuctionDetails({
                        initialRateBump: 0,
                        points: [],
                        duration: 120n,
                        startTime: srcTimestamp
                    }),
                    whitelist: [
                        {
                            address: new Address(src.resolver),
                            allowFrom: 0n
                        }
                    ],
                    resolvingStartTime: 0n
                },
                {
                    nonce: Sdk.randBigInt(UINT_40_MAX),
                    allowPartialFills: true,
                    allowMultipleFills: true
                }
            )

            const signature = await srcChainUser.signOrder(srcChainId, order)
            const orderHash = order.getOrderHash(srcChainId)
            // Resolver fills order
            const resolverContract = new Resolver(src.resolver, src.resolver)

            console.log(`[${srcChainId}]`, `Filling order ${orderHash}`)

            const fillAmount = order.makingAmount / 2n
            const idx = Number((BigInt(secrets.length - 1) * (fillAmount - 1n)) / order.makingAmount)

            const {txHash: orderFillHash, blockHash: srcDeployBlock} = await srcChainResolver.send(
                resolverContract.deploySrc(
                    srcChainId,
                    order,
                    signature,
                    Sdk.TakerTraits.default()
                        .setExtension(order.extension)
                        .setInteraction(
                            new Sdk.EscrowFactory(new Address(src.escrowFactory)).getMultipleFillInteraction(
                                Sdk.HashLock.getProof(leaves, idx),
                                idx,
                                secretHashes[idx]
                            )
                        )
                        .setAmountMode(Sdk.AmountMode.maker)
                        .setAmountThreshold(order.takingAmount),
                    fillAmount,
                    Sdk.HashLock.fromString(secretHashes[idx])
                )
            )

            console.log(`[${srcChainId}]`, `Order ${orderHash} filled for ${fillAmount} in tx ${orderFillHash}`)

            const srcEscrowEvent = await srcFactory.getSrcDeployEvent(srcDeployBlock)

            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))

            // console.log(`[${dstChainId}]`, `Depositing ${dstImmutables.amount} for order ${orderHash}`)
            // const {txHash: dstDepositHash, blockTimestamp: dstDeployedAt} = await dstChainResolver.send(
            //     resolverContract.deployDst(dstImmutables)
            // )
            // console.log(`[${dstChainId}]`, `Created dst deposit for order ${orderHash} in tx ${dstDepositHash}`)

            const secret = secrets[idx]

            const ESCROW_SRC_IMPLEMENTATION = await srcFactory.getSourceImpl()
            //const ESCROW_DST_IMPLEMENTATION = await dstFactory.getDestinationImpl()

            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(src.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                ESCROW_SRC_IMPLEMENTATION
            )

            // const dstEscrowAddress = new Sdk.EscrowFactory(new Address(dst.escrowFactory)).getDstEscrowAddress(
            //     srcEscrowEvent[0],
            //     srcEscrowEvent[1],
            //     dstDeployedAt,
            //     new Address(resolverContract.dstAddress),
            //     ESCROW_DST_IMPLEMENTATION
            // )

            await increaseTime(11) // finality lock passed
            // User shares key after validation of dst escrow deployment
            // console.log(`[${dstChainId}]`, `Withdrawing funds for user from ${dstEscrowAddress}`)
            // await dstChainResolver.send(
            //     resolverContract.withdraw('dst', dstEscrowAddress, secret, dstImmutables.withDeployedAt(dstDeployedAt))
            // )

            console.log(`[${srcChainId}]`, `Withdrawing funds for resolver from ${srcEscrowAddress}`)
            const {txHash: resolverWithdrawHash} = await srcChainResolver.send(
                resolverContract.withdraw('src', srcEscrowAddress, secret, srcEscrowEvent[0])
            )
            console.log(
                `[${srcChainId}]`,
                `Withdrew funds for resolver from ${srcEscrowAddress} to ${src.resolver} in tx ${resolverWithdrawHash}`
            )

            const resultBalances = await getBalances(
                config.chain.source.tokens.USDC.address,
                //config.chain.destination.tokens.USDC.address
            )

            // user transferred funds to resolver on the source chain
            expect(initialBalances.src.user - resultBalances.src.user).toBe(fillAmount)
            expect(resultBalances.src.resolver - initialBalances.src.resolver).toBe(fillAmount)
            // resolver transferred funds to user on the destination chain
            const dstAmount = (order.takingAmount * fillAmount) / order.makingAmount
            // expect(resultBalances.dst.user - initialBalances.dst.user).toBe(dstAmount)
            // expect(initialBalances.dst.resolver - resultBalances.dst.resolver).toBe(dstAmount)
        })
    })

    describe('Cancel', () => {
        it('should cancel swap Ethereum USDC -> Bsc USDC', async () => {
            const initialBalances = await getBalances(
                config.chain.source.tokens.USDC.address,
                //config.chain.destination.tokens.USDC.address
            )

            // User creates order
            const hashLock = Sdk.HashLock.forSingleFill(uint8ArrayToHex(randomBytes(32))) // note: use crypto secure random number in real world
            const order = Sdk.CrossChainOrder.new(
                new Address(src.escrowFactory),
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await srcChainUser.getAddress()),
                    makingAmount: parseUnits('100', 6),
                    takingAmount: parseUnits('99', 6),
                    makerAsset: new Address(config.chain.source.tokens.USDC.address),
                    takerAsset: new Address(config.chain.source.tokens.USDC.address)
                },
                {
                    hashLock,
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: 0n, // no finality lock for test
                        srcPublicWithdrawal: 120n, // 2m for private withdrawal
                        srcCancellation: 121n, // 1sec public withdrawal
                        srcPublicCancellation: 122n, // 1sec private cancellation
                        dstWithdrawal: 0n, // no finality lock for test
                        dstPublicWithdrawal: 100n, // 100sec private withdrawal
                        dstCancellation: 101n // 1sec public withdrawal
                    }),
                    srcChainId: Sdk.NetworkEnum.ETHEREUM,
                    dstChainId: Sdk.NetworkEnum.POLYGON,
                    srcSafetyDeposit: parseEther('0.001'),
                    dstSafetyDeposit: parseEther('0.001')
                },
                {
                    auction: new Sdk.AuctionDetails({
                        initialRateBump: 0,
                        points: [],
                        duration: 120n,
                        startTime: srcTimestamp
                    }),
                    whitelist: [
                        {
                            address: new Address(src.resolver),
                            allowFrom: 0n
                        }
                    ],
                    resolvingStartTime: 0n
                },
                {
                    nonce: Sdk.randBigInt(UINT_40_MAX),
                    allowPartialFills: false,
                    allowMultipleFills: false
                }
            )

            const signature = await srcChainUser.signOrder(srcChainId, order)
            const orderHash = order.getOrderHash(srcChainId)
            // Resolver fills order
            const resolverContract = new Resolver(src.resolver, src.resolver)

            console.log(`[${srcChainId}]`, `Filling order ${orderHash}`)
            const fillAmount = order.makingAmount
            const resolverContractTx = resolverContract.deploySrc(
                srcChainId,
                order,
                signature,
                Sdk.TakerTraits.default()
                    .setExtension(order.extension)
                    .setAmountMode(Sdk.AmountMode.maker)
                    .setAmountThreshold(order.takingAmount),
                fillAmount
            )
            console.log('resolverContractTx', resolverContractTx)
            const {txHash: orderFillHash, blockHash: srcDeployBlock} = await srcChainResolver.send(
                resolverContractTx
            )
                        
            console.log(`[${srcChainId}]`, `Order ${orderHash} filled for ${fillAmount} in tx ${orderFillHash}`)

            const srcEscrowEvent = await srcFactory.getSrcDeployEvent(srcDeployBlock)

            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))

            // console.log(`[${dstChainId}]`, `Depositing ${dstImmutables.amount} for order ${orderHash}`)
            // const {txHash: dstDepositHash, blockTimestamp: dstDeployedAt} = await dstChainResolver.send(
            //     resolverContract.deployDst(dstImmutables)
            // )
            // console.log(`[${dstChainId}]`, `Created dst deposit for order ${orderHash} in tx ${dstDepositHash}`)

            const ESCROW_SRC_IMPLEMENTATION = await srcFactory.getSourceImpl()
            //const ESCROW_DST_IMPLEMENTATION = await dstFactory.getDestinationImpl()

            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(src.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                ESCROW_SRC_IMPLEMENTATION
            )

            // const dstEscrowAddress = new Sdk.EscrowFactory(new Address(dst.escrowFactory)).getDstEscrowAddress(
            //     srcEscrowEvent[0],
            //     srcEscrowEvent[1],
            //     dstDeployedAt,
            //     new Address(resolverContract.dstAddress),
            //     ESCROW_DST_IMPLEMENTATION
            // )

            await increaseTime(125)
            // user does not share secret, so cancel both escrows
            // console.log(`[${dstChainId}]`, `Cancelling dst escrow ${dstEscrowAddress}`)
            // await dstChainResolver.send(
            //     resolverContract.cancel('dst', dstEscrowAddress, dstImmutables.withDeployedAt(dstDeployedAt))
            // )

            console.log(`[${srcChainId}]`, `Cancelling src escrow ${srcEscrowAddress}`)
            const {txHash: cancelSrcEscrow} = await srcChainResolver.send(
                resolverContract.cancel('src', srcEscrowAddress, srcEscrowEvent[0])
            )
            console.log(`[${srcChainId}]`, `Cancelled src escrow ${srcEscrowAddress} in tx ${cancelSrcEscrow}`)

            const resultBalances = await getBalances(
                config.chain.source.tokens.USDC.address,
                //config.chain.source.tokens.USDC.address
            )

            expect(initialBalances).toEqual(resultBalances)
        })
    })
})

async function initChain(
    cnf: ChainConfig, account: Account, prefill?: boolean, resolver_f?: string, escrowFactory_f?: string
): Promise<{node?: CreateServerReturnType; provider: any; wallet: any; escrowFactory: string; resolver: string}> {
    console.log('initChain', cnf)
    const {node, provider} = await getProvider(cnf)
    console.log('provider', provider)
    console.log('node', node)
    //const deployer = new SignerWallet(cnf.ownerPrivateKey, provider)

    // deploy EscrowFactory

    const [deployerAddress] = await walletClient.getAddresses()

    if (prefill) {
        escrowFactory_f = escrowFactory_f||''
        resolver_f = resolver_f||''
        console.log('initchain prefill return', prefill, resolver_f, escrowFactory_f)
        return {provider, wallet: walletClient, escrowFactory: escrowFactory_f, resolver: resolver_f}
    }

    const escrowFactory = await deploy(
        factoryContract,
        [
            cnf.limitOrderProtocol,
            cnf.wrappedNative, // feeToken,
            Address.fromBigInt(0n).toString(), // accessToken,
            deployerAddress, // owner
            60n * 30n  , // src rescue delay
            60n * 30n // dst rescue delay
        ],
        provider,
        account
    )
    console.log(`[${cnf.chainId}]`, `Escrow factory contract deployed to`, escrowFactory)

    // deploy Resolver contract
    const resolver = await deploy(
        resolverContract,
        [
            escrowFactory,
            cnf.limitOrderProtocol,
            computeAddress(resolverPk) // resolver as owner of contract
        ],
        provider,
        account
    )
    console.log(`[${cnf.chainId}]`, `Resolver contract deployed to`, resolver)

    return {provider, resolver, escrowFactory, wallet: walletClient}
}

async function getProvider(cnf: ChainConfig): Promise<{node?: CreateServerReturnType; provider: any}> {
    console.log('cnf', cnf)
    console.log('TEST WTF cnf.createFork', cnf.createFork)
    console.log('TYPE FORK', typeof cnf.createFork)
    if (!stringToBoolean(cnf.createFork || 'true')) {
        console.log("in getprovider!", cnf.url, cnf.chainId)
        console.log("Using direct RPC provider:", cnf.url, cnf.chainId)
        
        try {
            const provider = createPublicClient({
                chain: sepolia,
                transport: http(cnf.url)
            })
            console.log("Provider created:", provider)
            
            // Test the connection
            const blockNumber = await provider.getBlockNumber()
            console.log("Connected to block:", blockNumber)
            
            return {provider}
        } catch (error) {
            console.error("Failed to create provider:", error)
            throw error
        }
    }

    console.log("out getprovider!", cnf.url, cnf.chainId)

    const node = createServer({
        instance: anvil({forkUrl: cnf.url, chainId: cnf.chainId}),
        limit: 1
    })
    await node.start()

    const address = node.address()
    assert(address)

    const provider = new JsonRpcProvider(`http://[${address.address}]:${address.port}/1`, cnf.chainId, {
        cacheTimeout: -1,
        staticNetwork: true
    })

    return {
        provider,
        node
    }
}

/**
 * Deploy contract and return its address
 */
async function deploy(
    json: {abi: any; bytecode: any},
    params: unknown[],
    provider: PublicClient,
    account: Account
): Promise<string> {
    console.log('deploy params', params)
    //console.log('deploy json bytecode', json.bytecode)
    console.log('deploy provider', provider)
    console.log('deploy account', account)
    const hash = await walletClient.deployContract({
        abi: json.abi,
        account: account,
        bytecode: json.bytecode.object,
        args: params                // paramètres du constructeur
      })
    
      // 2. Attente du receipt
      const receipt = await provider.waitForTransactionReceipt({ hash })
    
      // 3. Retourne l’adresse du contrat fraîchement déployé
      return receipt.contractAddress as `0x${string}`
}

function stringToBoolean(str: string): boolean {
    return str.toLowerCase() === 'true';
}
