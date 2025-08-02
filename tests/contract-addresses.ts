/**
 * Contract addresses for different networks
 * This file centralizes all contract addresses for easy modification
 */

export const CONTRACT_ADDRESSES = {
    // Ethereum Sepolia testnet
    sepolia: {
        chainId: 1,//11155111, // Sepolia testnet
        rpcUrl:
            process.env.SEPOLIA_RPC_URL ||
            'https://g.w.lavanet.xyz:443/gateway/sep1/rpc-http/d3630392db153e71701cd89c262c116e',

        // Deployed contract addresses from terminal output

        resolver: '0xfd1E34f7859FB8b758BcE4ba4fbf1891664960bE' as `0x${string}`,
        escrowFactory: '0x1948eFaf98abF2C7Df95e7Df4A1618F8F202D28a' as `0x${string}`,
        escrowSrcImpl: '0x6B17E6fDdc8752919aF841E852fcB1A31F59Fbe9' as `0x${string}`,
        escrowDstImpl: '0x6D124e34Edc81216F60b710C87F9b1cF138679Ad' as `0x${string}`,
        limitOrderProtocol: '0xd896FD11857400DDfD92A0824f6108e875670f3f' as `0x${string}`,


        // Token addresses
        tokens: {
            ERC20True: {
                address: '0x96e2979a7C49Dd827DDD0e6eD0BC26a75825d5cc' as `0x${string}`,
                decimals: 18
            },
            USDC: {
                address: '0xe4405318d9b679A4309323F84b9e59560d78CC23' as `0x${string}`,

                decimals: 6
            },
            WETH: {
                address: '0x4121CC48aB1cf23C63ACbDC6Da317c392de86F3D' as `0x${string}`,
                decimals: 18
            }
        }
    },

    // Ethereum mainnet (for reference)
    mainnet: {
        chainId: 1,
        rpcUrl: process.env.MAINNET_RPC_URL || '',

        // Add mainnet addresses when available
        resolver: '' as `0x${string}`,
        escrowFactory: '' as `0x${string}`,
        escrowSrcImpl: '' as `0x${string}`,
        escrowDstImpl: '' as `0x${string}`,
        limitOrderProtocol: '' as `0x${string}`,

        tokens: {
            ERC20True: {
                address: '0xA0b86a33E6441E6C7D3E4C7C5C6C7C5C6C7C5C6C' as `0x${string}`, // Example
                decimals: 18
            },
            USDC: {
                address: '0xA0b86a33E6441E6C7D3E4C7C5C6C7C5C6C7C5C6C' as `0x${string}`, // Example
                decimals: 6
            }
        }
    },

    // Sui testnet (non-EVM chain)
    sui: {
        chainId: 101, // Custom chainId for Sui (non-EVM)
        rpcUrl: 'https://fullnode.testnet.sui.io:443',

        // Sui testnet deployed Move packages (Sui object IDs)
        resolver: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29',
        escrowFactory: '0xb2fd8fc01a7f50db9693ad1415d0c193ad3906494428cf252621037bd7117e30',
        escrowSrcImpl: '0xc3fe9fd02b8f60db9693ad1415d0c193ad3906494428cf252621037bd7117e31',
        escrowDstImpl: '0xd4ff0fe03c9f70db9693ad1415d0c193ad3906494428cf252621037bd7117e32',

        tokens: {
            ERC20True: {
                // Sui ERC20True token address (example format)
                address: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::erc20_true::ERC20True',
                decimals: 18
            },
            USDC: {
                // Sui USDC coin type (Move type identifier)
                address: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
                decimals: 6
            }
        }
    }
} as const

// Type helpers
export type NetworkName = keyof typeof CONTRACT_ADDRESSES
export type EthereumNetwork = 'sepolia' | 'mainnet'
export type SuiNetwork = 'sui'

// Helper functions
export function getEthereumConfig(network: EthereumNetwork) {
    return CONTRACT_ADDRESSES[network]
}

export function getSuiConfig() {
    return CONTRACT_ADDRESSES.sui
}

// Validation helpers
export function validateEthereumAddresses(network: EthereumNetwork): boolean {
    const config = CONTRACT_ADDRESSES[network]

    return !!(
        config.resolver &&
        config.escrowFactory &&
        config.escrowSrcImpl &&
        config.escrowDstImpl &&
        config.limitOrderProtocol
    )
}

export function validateSuiAddresses(): boolean {
    const config = CONTRACT_ADDRESSES.sui

    return !!(config.resolver && config.escrowFactory && config.escrowSrcImpl && config.escrowDstImpl)
}
