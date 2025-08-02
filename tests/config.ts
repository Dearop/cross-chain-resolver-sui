import {z} from 'zod'
import Sdk from '@1inch/cross-chain-sdk'
import * as process from 'node:process'
import {CONTRACT_ADDRESSES} from './contract-addresses'
const bool = z
    .string()
    .transform((v) => v.toLowerCase() === 'true')
    .pipe(z.boolean())

const ConfigSchema = z.object({
    SRC_CHAIN_RPC: z.string().url(),
    DST_CHAIN_RPC: z.string().url(),
    SRC_CHAIN_CREATE_FORK: bool.default('true'),
    DST_CHAIN_CREATE_FORK: bool.default('true')
})

const fromEnv = ConfigSchema.parse(process.env)

export const config = {
    chain: {
        source: {
            chainId: Sdk.NetworkEnum.ETHEREUM,
            url: fromEnv.SRC_CHAIN_RPC,
            createFork: process.env.SRC_CHAIN_CREATE_FORK,
            limitOrderProtocol: CONTRACT_ADDRESSES.sepolia.limitOrderProtocol,
            wrappedNative: CONTRACT_ADDRESSES.sepolia.tokens.WETH.address,
            ownerPrivateKey: process.env.USER_PRIVATE_KEY as `0x${string}`,
            tokens: {
                USDC: {
                    address: CONTRACT_ADDRESSES.sepolia.tokens.USDC.address,
                    donor: process.env.USER_PRIVATE_KEY as `0x${string}`
                }
            }
        },
    }
} as const

export type ChainConfig = (typeof config.chain)['source']
