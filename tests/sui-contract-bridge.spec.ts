import 'dotenv/config';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { SuiObjectChange } from '@mysten/sui/client';
import { resourceLimits } from 'worker_threads';
//import { fromB64 } from '@mysten/sui/utils';

// Environment variables for Sui configuration
const SUI_PACKAGE_ID = process.env.SUI_PACKAGE_ID;
const SUI_NETWORK = process.env.SUI_NETWORK || 'testnet';
const SUI_PRIVATE_KEY_INIT = process.env.SUI_PRIVATE_KEY_INIT;
const SUI_PRIVATE_KEY_THIRD_PARTY = process.env.SUI_PRIVATE_KEY_THIRD_PARTY;

// Validate required environment variables
if (!SUI_PACKAGE_ID) {
    throw new Error('SUI_PACKAGE_ID environment variable is required');
}

// Types for the bridge system
export interface HTLCLockParams {
    withdrawalMs: number;
    publicWithdrawalMs: number;
    cancellationMs: number;
    publicCancellationMs: number;
    hashLock: string;
    refund: string;
    recipient: string;
    secretLength: number;
    amount: string;
    safetyDeposit: string;
}

export interface HTLCWithdrawParams {
    lockId: string;
    secret: string;
    initVersion: bigint;
}

export interface HTLCCancelParams {
    lockId: string;
    initVersion: bigint;
}

export interface HTLCResult {
    success: boolean;
    txDigest?: string;
    lockId?: string;
    initVersion: bigint;
    error?: string;
    details?: any;
}

/**
 * Sui HTLC Contract Bridge
 * 
 * This class provides a clean TypeScript interface to call your Sui Move contract functions.
 * It follows the patterns from the Sui Move Bootcamp H4 solution.
 */
export class SuiHTLCBridge {
    private client: SuiClient;
    private keypair: Ed25519Keypair;

    constructor(privateKey?: string) {
        // Initialize Sui client for the configured network
        this.client = new SuiClient({ url: getFullnodeUrl(SUI_NETWORK as any) });
        
        // Initialize keypair with proper error handling
        if (privateKey) {
            // Use provided private key
            this.keypair = Ed25519Keypair.fromSecretKey(privateKey);
        } else if (SUI_PRIVATE_KEY_INIT && SUI_PRIVATE_KEY_INIT.trim() !== "" && SUI_PRIVATE_KEY_INIT !== "undefined") {
            // Use environment variable private key
            this.keypair = Ed25519Keypair.fromSecretKey(SUI_PRIVATE_KEY_INIT);
        } else {
            // Generate new keypair for testing
            this.keypair = Ed25519Keypair.generate();
        }
        
        console.log('🔑 Using keypair address:', this.keypair.getPublicKey().toSuiAddress());
        console.log('🌐 Connected to Sui', SUI_NETWORK);
        console.log('📦 Package ID:', SUI_PACKAGE_ID);
    }

    /**
     * Create HTLC Lock Object
     * 
     * TypeScript function that calls the Move contract's create_lock_object function
     * 
     * @param params HTLCLockParams - Parameters for creating the lock
     * @returns Promise<HTLCResult> - Result of the operation
     */
    async createLockObject(params: HTLCLockParams): Promise<HTLCResult> {
        console.log('🏗️ Creating HTLC lock object...');
        console.log('📦 Package ID:', SUI_PACKAGE_ID);
        console.log('🔧 Function: oneinch_move::create_lock_object');
        
        try {
            const tx = new Transaction();
            
            // Split coins for the lock amount and safety deposit
            const [lockCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(params.amount)]);
            const [safetyDepositCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(params.safetyDeposit)]);
            
            // Convert hashLock from hex string to byte array
            const hashLockBytes = [...Buffer.from(params.hashLock.slice(2), 'hex')];
            const hashVec = tx.pure.vector('u8', hashLockBytes);
            
            // Call the Move contract function with ALL required arguments
            tx.moveCall({
                target: `${SUI_PACKAGE_ID}::oneinch_move::create_lock_object`,
                typeArguments: ['0x2::sui::SUI'], 
                arguments: [
                    tx.object('0x6'),                                    
                    tx.pure.u64(params.withdrawalMs),             // withdrawal_ms: u64
                    tx.pure.u64(params.publicWithdrawalMs),       // public_withdrawal_ms: u64
                    tx.pure.u64(params.cancellationMs),           // cancellation_ms: u64
                    tx.pure.u64(params.publicCancellationMs),     // public_cancellation_ms: u64
                    hashVec,                        // hashed: vector<u8>
                    tx.pure.address(params.refund),                 // refund: address
                    tx.pure.address(params.recipient),              // target: address
                    //tx.pure.address(params.initiator),              // initiator: address
                    tx.pure.u8(params.secretLength),             // secret_length: u8
                    lockCoin,                                 // amount: Coin<T>
                    safetyDepositCoin,                              // deposit: Coin<T>
                    
                ]
            });

            // Set gas budget
            //TODO: make sure we remove it for final implementation
            tx.setGasBudget(10_000_000);

            console.log('📝 Transaction created, executing...');
            console.log('🔑 Using keypair address:', this.keypair.getPublicKey().toSuiAddress());
            console.log('💰 Lock amount:', params.amount, 'MIST');
            console.log('💎 Safety deposit:', params.safetyDeposit, 'MIST');
            
            const result = await this.client.signAndExecuteTransaction({
                transaction: tx,
                signer: this.keypair,
                options: {
                    showEffects: true,
                    showObjectChanges: true,
                    showInput: true,
                    showEvents: true
                }
            });

            const transaction = await this.client.waitForTransaction({
                digest: result.digest,
                options: {
                    showEffects: true,
                    showObjectChanges: true,
                },
            });
  
            // Extract created lock object ID from object changes
            
            console.log('result', transaction)
            console.log('result.objectChanges', transaction.objectChanges)
            //console.log('result.objectChanges type', result.objectChanges?.type)
            const lockObj = transaction.objectChanges?.find(
                c => ((c as any).type === "created" || (c as any).type === "shared") &&
                     (c as any).objectType.startsWith(`${SUI_PACKAGE_ID}::oneinch_move::LockObject`)
              );
            if (!lockObj) throw new Error("Lock Object Not Found");
            const lockId = (lockObj as any).objectId;                    // ✔ TypeScript sait
              
            const lockVersion = BigInt((lockObj as any).version);

            
            //const lockChange = result.objectChanges?.find(pickLockObject)
            // …otherwise fall back to the `created` list

            console.log('✅ HTLC lock object created successfully!');
            console.log('📋 Transaction digest:', result.digest);
            console.log('🔗 View on explorer:', `https://suiexplorer.com/txblock/${result.digest}?network=${SUI_NETWORK}`);
          

            //const lockId = (lockChange as any).objectId;
            //const initVersion = BigInt((lockId as any).version);
            
            return {
                success: true,
                txDigest: transaction.digest,
                lockId,
                initVersion: lockVersion,
                details: transaction
            };
            
        } catch (error: any) {
            console.error('❌ Error creating HTLC lock object:', error);
            return {
                success: false,
                error: error.message,
                details: error,
                initVersion: BigInt(0)
            };
        }
    }

    /**
     * Withdraw from HTLC Lock Object
     * 
     * TypeScript function that calls the Move contract's withdraw function
     * 
     * @param params HTLCWithdrawParams - Parameters for withdrawal
     * @returns Promise<HTLCResult> - Result of the operation
     */
    async withdrawLock(params: HTLCWithdrawParams): Promise<HTLCResult> {
        console.log('💰 Withdrawing from HTLC lock object...');
        console.log('📦 Lock ID:', params.lockId);
        console.log('🔧 Function: oneinch_move::withdraw');
        
        try {
            
            if (!params.initVersion || params.initVersion === 0n) {
                const obj = await this.client.getObject({
                  id: params.lockId,
                  options: { showOwner: true },
                });
                console.log('obj type', typeof obj)
                const shared = (obj.data as any)?.owner?.Shared;
                if (!shared?.initial_shared_version) {
                  throw new Error(`Lock ${params.lockId} is not shared or initial_shared_version unavailable`);
                }
                params.initVersion = BigInt(shared.initial_shared_version);
            }


            const tx = new Transaction();
            
            // Call the Move contract function
            tx.moveCall({
                target: `${SUI_PACKAGE_ID}::oneinch_move::withdraw`,
                typeArguments: ['0x2::sui::SUI'],
                arguments: [
                    tx.sharedObjectRef({
                      objectId: params.lockId,
                      initialSharedVersion: params.initVersion.toString(),
                      mutable: true,
                    }),
                    tx.object('0x6'),
                    tx.pure.vector('u8', [...Buffer.from(params.secret, 'utf8')]),  // ✔
                  ],
              });

            console.log('📝 Withdrawal transaction created, executing...');

            //TODO: make sure we remove it for final implementation
            tx.setGasBudget(100_000_000);
              // now withdraw safely
              
            //await this.client.waitForTransaction({ digest: createResult.txDigest });
            //await this.client.cache.reset();   // clear the client‑side coin cache
              
                        
            const result = await this.client.signAndExecuteTransaction({
                transaction: tx,
                signer: this.keypair,
                options: {
                    showEffects: true,
                    showObjectChanges: true,
                    showInput: true,
                    showEvents: true
                }
            });

            const final = await this.client.waitForTransaction({
                digest: result.digest,
                options: { showEffects: true, showObjectChanges: true, showEvents: true },
                timeout: 45_000,
              });
          
            const status = final.effects?.status;
            if (status?.status !== 'success') {
            // -> Move a abort : on renvoie une erreur claire
            throw new Error(
                `Withdraw failed on-chain (status=${status?.status}, error=${status?.error})`,
            );
            }

            console.log('✅ Withdraw OK, digest', final.digest);
            return {
            success: true,
            txDigest: final.digest,
            details: final,
            initVersion: params.initVersion,
            };
            
        } catch (error: any) {
            console.error('❌ Error withdrawing from HTLC lock object:', error);
            return {
                success: false,
                error: error.message || String(error),           
                details: error,
                initVersion: params.initVersion
            };
        }
    }

    /**
     * Cancel HTLC Lock Object
     * 
     * TypeScript function that calls the Move contract's cancel function
     * 
     * @param params HTLCCancelParams - Parameters for cancellation
     * @returns Promise<HTLCResult> - Result of the operation
     */
    async cancelLock(params: HTLCCancelParams): Promise<HTLCResult> {
        console.log('❌ Cancelling HTLC lock object...');
        console.log('📦 Lock ID:', params.lockId);
        console.log('🔧 Function: oneinch_move::cancel');
        
        try {
            const tx = new Transaction();
            
            tx.moveCall({
                target: `${SUI_PACKAGE_ID}::oneinch_move::cancel`,
                typeArguments: ['0x2::sui::SUI'],
                arguments: [
                    tx.sharedObjectRef({
                        objectId: params.lockId,
                        initialSharedVersion: params.initVersion.toString(),
                        mutable: true,
                      }),
                  tx.object('0x6'),
                ],
              });

            console.log('📝 Cancellation transaction created, executing...');

            //TODO: make sure we remove it for final implementation
            tx.setGasBudget(10_000_000);
            
            const result = await this.client.signAndExecuteTransaction({
                transaction: tx,
                signer: this.keypair,
                options: {
                    showEffects: true,
                    showObjectChanges: true,
                    showInput: true,
                    showEvents: true
                }
            });

            const final = await this.client.waitForTransaction({
                digest: result.digest,
                timeout: 45_000,
                options: {
                  showEffects: true,
                  showObjectChanges: true,
                  showEvents: true,
                },
              });

            const status = final.effects?.status;

            if (status?.status !== 'success') {
            throw new Error(
                `Cancel failed on-chain (status=${status?.status}, error=${status?.error})`,
            );
            }

            console.log('✅ Cancel OK, digest', final.digest);
            return {
            success: true,
            txDigest: final.digest,
            details: final,
            initVersion: params.initVersion,
            };

        } catch (error: any) {
            console.error('❌ Error cancelling HTLC lock object:', error);
            return {
                success: false,
                error: error.message || String(error),
                details: error,
                initVersion: params.initVersion
            };
        }
    }

    /**
     * Get account balance
     */
    async getBalance(): Promise<any> {
        console.log('💰 Getting account balance...');
        
        try {
            const address = this.keypair.getPublicKey().toSuiAddress();
            const balance = await this.client.getBalance({
                owner: address,
                coinType: '0x2::sui::SUI'
            });

            console.log('📊 Balance:', balance);
            return balance;
        } catch (error) {
            console.error('❌ Error getting balance:', error);
            throw error;
        }
    }

    /**
     * Get account objects
     */
    async getObjects(): Promise<any> {
        console.log('📦 Getting account objects...');
        
        try {
            const address = this.keypair.getPublicKey().toSuiAddress();
            const objects = await this.client.getOwnedObjects({
                owner: address,
                options: {
                    showContent: true,
                    showDisplay: true
                }
            });

            console.log('📋 Objects:', objects);
            return objects;
        } catch (error) {
            console.error('❌ Error getting objects:', error);
            throw error;
        }
    }

    /**
     * Get the Sui address for this keypair
     */
    getAddress(): string {
        return this.keypair.getPublicKey().toSuiAddress();
    }

    public getClient() {
        return this.client;
    }
    
}

function pickLockObject(change: SuiObjectChange) {
    return (
      change.type === 'created' &&
      change.objectType.startsWith(
        `${SUI_PACKAGE_ID}::oneinch_move::LockObject`
      )
    );
  }

// Example usage function

export async function exampleUsage() {
    console.log('🚀 Starting Sui HTLC Bridge Example...');
    console.log('�� Package ID:', SUI_PACKAGE_ID);
    console.log('🌐 Network:', SUI_NETWORK);
    console.log('');

    // Initialize the bridge
    const bridge = new SuiHTLCBridge(SUI_PRIVATE_KEY_INIT);
    const bridgeThirdParty = new SuiHTLCBridge(SUI_PRIVATE_KEY_THIRD_PARTY);

    try {
        // Step 1: Check balance
        console.log('=== Step 1: Check Balance ===');
        await bridge.getBalance();
        console.log('');

        // Step 2: Check objects
        console.log('=== Step 2: Check Objects ===');
        await bridge.getObjects();
        console.log('');

        // Step 3: Create HTLC lock object
        console.log('=== Step 3: Create HTLC Lock Object ===');
        const createParams: HTLCLockParams = {
            hashLock: '0x33d8b47bfa962a165d3d0273ffd199d7d3fae4a908f525edb4e8a6b024b89c2d',
            //hashLock: '0x33d8b47bfa962a165d3d0273ffd199d7d3fae4a908f527edb4e8a6b024b89c2d',   //Pour fail secretpreimage
            amount: '5000', // 0.005 SUI in MIST
            recipient: '0x602ab088566e1967e9f9c216b307a3c1962ba46035248e1c4ff61c0565796fcd',
            refund: '0xe561b9b876e07f091cacb4d6e2d20236d661e04323f3851bde7dce0607435b69',
            withdrawalMs: 10000, // 10 seconds
            publicWithdrawalMs: 20000, // 20 secondes
            cancellationMs: 30000, // 30 secondes
            publicCancellationMs: 40000, // 40 secondes
            secretLength: 16,
            safetyDeposit: '1000' // 0.001 SUI in MIST
        };

        console.log('timestamp_create', new Date().getTime());
        const createResult = await bridge.createLockObject(createParams);
        
        console.log('createResult', createResult)

        if (createResult.success && createResult.lockId) {
            console.log('✅ Lock created successfully!');
            console.log('📦 Lock ID:', createResult.lockId);
            console.log('📋 Transaction:', createResult.txDigest);
            console.log('');

            // Step 4: Get lock object info (optional)
            console.log('=== Step 4: Get Lock Object Info ===');
            // You can add a method to get lock object info here
            console.log('');

            // Uncomment to test withdrawal
            console.log('=== Step 5: Withdraw Lock Object ===');

            const withdrawParams: HTLCWithdrawParams = {
                 lockId: createResult.lockId,  // This should be the actual object ID
                 secret: 'my-secret-key-12',
                 initVersion: createResult.initVersion
                 //secret: "my-secret-key-123"   //Pour tester wrong secret length, rend code 2 sur suiscan
             };

            
            // DEBUG ALL
            console.log('withdrawParams', withdrawParams)
            console.log(' Lock ID being used:', createResult.lockId);
            console.log('🔍 Lock ID type:', typeof createResult.lockId);


            console.log('🔍 Full Debug:');
            console.log('Hash Lock:', createParams.hashLock);
            console.log('Secret:', withdrawParams.secret);
            console.log('Lock ID:', createResult.lockId);
            console.log('Create TX:', createResult.txDigest);
            

            
            // Check lock object
            console.log('🔍 Checking lock object...');
            try {
                const lockObject = await bridge.getClient().getObject({  // ✅ Use getClient()
                    id: createResult.lockId,
                    options: { showContent: true, showDisplay: true }
                });
                console.log(' Lock object exists:', !!lockObject.data);
                console.log('🔍 Lock object content:', lockObject.data?.content);
                console.log('🔍 Lock object display:', lockObject.data?.display);
            } catch (error) {
                console.error('❌ Error getting lock object:', error);
            }
            

            
            // Check gas coins
            console.log('⛽ Checking gas coins...');
            const gasObjects = await bridge.getClient().getOwnedObjects({
                owner: bridge.getAddress(),
                options: {
                    showContent: true,
                    showDisplay: true
                }
            });
            console.log('💰 Gas objects count:', gasObjects.data?.length || 0);
            console.log(' Gas objects:', gasObjects.data?.map(obj => ({
                id: obj.data?.objectId,
                type: obj.data?.type
            })));
            

            
            //GAS DEBUG
            console.log('🔍 Gas Debug:');
            const balance = await bridge.getBalance();
            console.log('Balance:', balance.totalBalance);
            console.log('Gas budget needed:', 100_000_000);
            console.log('Enough gas?', parseInt(balance.totalBalance) >= 100_000_000);

            // Wait for create transaction to be confirmed
            console.log('⏳ Waiting for create transaction to be confirmed...');
            console.log('createResult.txDigest', createResult.txDigest)
            if (createResult.txDigest) {
                await bridge.getClient().waitForTransaction({ 
                    digest: createResult.txDigest,
                    timeout: 30000 
                });
                console.log('✅ Create transaction confirmed!');
            } else {
                console.log('❌ No transaction digest available');
            }

            // Uncomment to test withdrawal by resolver
            
            console.log('timestamp_withdraw_pre_wait', new Date().getTime());
            console.log('⏳ Waiting 10 seconds before withdrawal...');
            await new Promise(resolve => setTimeout(resolve, 10000));   //commenter pour fail WithdrawNotAvailable (code5 suiscan)
            console.log('timestamp_withdraw_post_wait', new Date().getTime());
            const withdrawResult = await bridge.withdrawLock(withdrawParams);
            console.log('Withdraw result:', withdrawResult);
            console.log(''); 
            
            
             // Uncomment to test withdrawal by public
            /*
            console.log('timestamp_withdraw_pre_wait', new Date().getTime());
            console.log('⏳ Waiting 20 seconds before withdrawal...');
            //console.log('⏳ Waiting 10 seconds before withdrawal... Expect fail');
            await new Promise(resolve => setTimeout(resolve, 20000));   //mettre a 10000 pour fail WithdrawNotAllowed (code6 suiscan)
            console.log('timestamp_withdraw_post_wait', new Date().getTime());
            const withdrawResultThirdParty = await bridgeThirdParty.withdrawLock(withdrawParams);
            //const withdrawResultInit = await bridge.withdrawLock(withdrawParams);  //Test resolver during public time
            //console.log('Withdraw result:', withdrawResultInit);  //Res resolver during public time
            console.log('Withdraw result:', withdrawResultThirdParty);
            console.log(''); 
            */

            // Uncomment to test cancellation by resolver
            /*
            console.log('=== Step 6: Cancel Lock Object ===');
            const cancelParams: HTLCCancelParams = {
                lockId: createResult.lockId,
                initVersion: createResult.initVersion
            };

            console.log('timestamp_cancel_pre_wait', new Date().getTime());
            console.log('⏳ Waiting 30 seconds before cancel...');
            //await new Promise(resolve => setTimeout(resolve, 30000));   //commenter pour fail CancelNotAvailable (code3 suiscan)
            console.log('timestamp_cancel_post_wait', new Date().getTime());

            const cancelResult = await bridge.cancelLock(cancelParams);
            console.log('Cancel result:', cancelResult);
            console.log('');
            */

            // Uncomment to test cancellation by public
            /*
            console.log('=== Step 6: Cancel Lock Object ===');
            const cancelParams: HTLCCancelParams = {
                lockId: createResult.lockId,
                initVersion: createResult.initVersion
            };

            console.log('timestamp_cancel_pre_wait', new Date().getTime());
            console.log('⏳ Waiting 40 seconds before cancel...');
            await new Promise(resolve => setTimeout(resolve, 30000));   //commenter a <40000 pour fail CancelNotllowed (code4 suiscan)
            console.log('timestamp_cancel_post_wait', new Date().getTime());
            const cancelResultThirdParty = await bridgeThirdParty.cancelLock(cancelParams);
            //const cancelResult = await bridge.cancelLock(cancelParams);  //Cancel by resolver during public time
            console.log('Cancel result_thirdparty:', cancelResultThirdParty);
            //console.log('Cancel result:', cancelResult);
            console.log('');
            */
            

        } else {
            console.error('❌ Failed to create lock:', createResult.error);
    }

    } catch (error) {
        console.error('❌ Example execution error:', error);
        console.log('');
        console.log('💡 Tips:');
        console.log('1. Make sure you have SUI tokens on', SUI_NETWORK);
        console.log('2. Get testnet SUI from: https://suiexplorer.com/faucet');
        console.log('3. Check the transaction on: https://suiexplorer.com/');
        console.log('4. Your package on', SUI_NETWORK, ':', `https://suiexplorer.com/object/${SUI_PACKAGE_ID}?network=${SUI_NETWORK}`);
    }
}

describe('Sui HTLC Bridge', () => {
    it('should run example usage', async () => {
        await exampleUsage();
    }, 120000); // 2 minute timeout for network operations
});