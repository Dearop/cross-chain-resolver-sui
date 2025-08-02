import { FallbackProvider, JsonRpcProvider, Wallet as EthersWallet } from 'ethers'
import type { Chain, Client, Transport, WalletClient, Account } from 'viem'
import { createPublicClient, http, createWalletClient } from 'viem'
import {privateKeyToAccount} from 'viem/accounts'

export function clientToProvider(client: Client<Transport, Chain>) {
  const { chain, transport } = client
  const network = {
    chainId: chain.id,
    name: chain.name,
    ensAddress: chain.contracts?.ensRegistry?.address,
  }
  if (transport.type === 'fallback') {
    const providers = (transport.transports as ReturnType<Transport>[]).map(
      ({ value }) => new JsonRpcProvider(value?.url, network),
    )
    if (providers.length === 1) return providers[0]
    return new FallbackProvider(providers)
  }
  return new JsonRpcProvider(transport.url, network)
}

/** Convert a viem WalletClient to an ethers.js Wallet */
export function walletClientToEthersSigner(walletClient: WalletClient, provider: JsonRpcProvider) {
  // For now, we'll use the private key approach since we need ethers compatibility
  // This is a simplified adapter - in production you might want more sophisticated handling
  return provider.getSigner(walletClient.account?.address)
}

/** Create ethers provider from RPC URL */
export function createEthersProvider(rpcUrl: string, chainId: number, chainName: string) {
  return new JsonRpcProvider(rpcUrl, {
    chainId,
    name: chainName
  })
}

/** Create viem public client */
export function createViemPublicClient(rpcUrl: string, chain: Chain) {
  return createPublicClient({
    chain,
    transport: http(rpcUrl)
  })
}

/** Create viem wallet client from private key */
export function createViemWalletClient(privateKey: `0x${string}`, rpcUrl: string, chain: Chain) {
  const account = privateKeyToAccount(privateKey)
  return createWalletClient({
    account,
    chain,
    transport: http(rpcUrl)
  })
}