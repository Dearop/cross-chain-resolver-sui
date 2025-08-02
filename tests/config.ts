import {z} from 'zod'
import Sdk from '@1inch/cross-chain-sdk'
import * as process from 'node:process'

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
            chainId: 11155111, // Sepolia testnet
            url: fromEnv.SRC_CHAIN_RPC,
            createFork: process.env.SRC_CHAIN_CREATE_FORK,
            limitOrderProtocol: '0x88B25C9b2209113b9705B31fbfdd298c1f9ED9ec',
            wrappedNative: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            ownerPrivateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
            resolver : '0xfd1E34f7859FB8b758BcE4ba4fbf1891664960bE',
            escrowFactory : '0x1948eFaf98abF2C7Df95e7Df4A1618F8F202D28a',
            escrowSrc : '0x6B17E6fDdc8752919aF841E852fcB1A31F59Fbe9',
            escrowDst : '0x6D124e34Edc81216F60b710C87F9b1cF138679Ad',
            lop : '0xd896FD11857400DDfD92A0824f6108e875670f3f',
            tokens: {
                USDC: {
                    address: '0xB718FF84779B917B5955a333ae8A1ff431687A7d',
                    donor: '0xd54F23BE482D9A58676590fCa79c8E43087f92fB'
                }
            }
        },
    }
} as const

export type ChainConfig = (typeof config.chain)['source']