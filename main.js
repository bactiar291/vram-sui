const { SuiClient } = require('@mysten/sui.js/client');
const { Ed25519Keypair } = require('@mysten/sui.js/keypairs/ed25519');
const { decodeSuiPrivateKey } = require('@mysten/sui.js/cryptography');
const { TransactionBlock } = require('@mysten/sui.js/transactions');
require('dotenv').config();

const SUI_NETWORK = 'https://fullnode.testnet.sui.io:443';
const PACKAGE_ID = '0x5f422eac8ed9d1c87b3d033915fdfde4355e945db190e85e07a480cf662bb13f';
const VRAM_TOKEN_TYPE = '0x785082b640fb4de6fa0804c3fbf80297c49c875d825db7cd56cd65b03902b48a::tram_token::TRAM_TOKEN';
const ANAM01_TOKEN_TYPE = '0xe305c6628e23cd927c6b4b7b9213a2b20d99e431944742a0ee0d4dd3efcb46f6::anam01::ANAM01';

const MARKET_OBJECT = '0x2262aef57f12b7ec3107ba06de44a7bf73f692803cc976052469b44c02c0c09b';
const POOL_OBJECT = '0xe1a66da5266dda9ac35e1877b728bc2056beb6c9172e2a85fd031eba1789f2c2';

function getKeypair(privateKey) {
    try {
        if (privateKey.startsWith('suiprivkey')) {
            const { secretKey } = decodeSuiPrivateKey(privateKey);
            return Ed25519Keypair.fromSecretKey(secretKey);
        }

        if (privateKey.length === 64) {
            return Ed25519Keypair.fromSecretKey(Buffer.from(privateKey, 'hex'));
        }

        if (privateKey.startsWith('0x') && privateKey.length === 66) {
            return Ed25519Keypair.fromSecretKey(Buffer.from(privateKey.slice(2), 'hex'));
        }

        const buffer = Buffer.from(privateKey, 'base64');
        if (buffer.length === 32) {
            return Ed25519Keypair.fromSecretKey(buffer);
        }

        throw new Error('Format private key tidak dikenali');
    } catch (error) {
        throw new Error(`Gagal memproses private key: ${error.message}`);
    }
}

function getKeypairFromMnemonic(mnemonic) {
    try {
        return Ed25519Keypair.deriveKeypair(mnemonic);
    } catch (error) {
        throw new Error(`Gagal memproses mnemonic: ${error.message}`);
    }
}

async function buyAnam01Token(amountVram, minAmountOut, address, vramCoinId) {
    const tx = new TransactionBlock();

    const [splitCoin] = tx.splitCoins(tx.object(vramCoinId), [
        tx.pure(amountVram)
    ]);

    tx.moveCall({
        target: `${PACKAGE_ID}::vram::buy`,
        typeArguments: [ANAM01_TOKEN_TYPE, VRAM_TOKEN_TYPE],
        arguments: [
            tx.object(MARKET_OBJECT),
            tx.object(POOL_OBJECT),
            splitCoin,
            tx.pure('18446744073709551615'), 
            tx.pure(minAmountOut),
            tx.pure(address)
        ]
    });

    tx.setGasBudget(10000000);

    try {
        const result = await client.signAndExecuteTransactionBlock({
            transactionBlock: tx,
            signer: keypair,
            options: { showEffects: true }
        });

        console.log('✅ Pembelian berhasil!');
        console.log('Digest:', result.digest);
        console.log('Dibelanjakan:', amountVram.toString() / 1e9, 'VRAM');

        return result;
    } catch (error) {
        console.error('❌ Pembelian gagal:', error.message);
        return null;
    }
}

async function sellAnam01Token(amountAnam, minAmountOut, anamCoinId) {
    const tx = new TransactionBlock();

    const [splitCoin] = tx.splitCoins(tx.object(anamCoinId), [
        tx.pure(amountAnam)
    ]);

    tx.moveCall({
        target: `${PACKAGE_ID}::vram::sell`,
        typeArguments: [ANAM01_TOKEN_TYPE, VRAM_TOKEN_TYPE],
        arguments: [
            tx.object(MARKET_OBJECT),
            tx.object(POOL_OBJECT),
            splitCoin,
            tx.pure(minAmountOut)
        ]
    });

    tx.setGasBudget(10000000);

    try {
        const result = await client.signAndExecuteTransactionBlock({
            transactionBlock: tx,
            signer: keypair,
            options: { showEffects: true }
        });

        console.log('✅ Penjualan berhasil!');
        console.log('Digest:', result.digest);
        console.log('Dijual:', amountAnam.toString(), 'ANAM01');

        return result;
    } catch (error) {
        console.error('❌ Penjualan gagal:', error.message);
        return null;
    }
}

async function getCoinWithMinBalance(coinType, minBalance) {
    const coins = await client.getCoins({
        owner: address,
        coinType,
    });

    const suitableCoin = coins.data.find(coin =>
        BigInt(coin.balance) >= BigInt(minBalance)
    );

    return suitableCoin ? suitableCoin.coinObjectId : null;
}

async function showBalances() {
    try {
        const vramCoins = await client.getCoins({
            owner: address,
            coinType: VRAM_TOKEN_TYPE,
        });
        const vramBalance = vramCoins.data.reduce((sum, coin) => sum + BigInt(coin.balance), 0n);

        const anamCoins = await client.getCoins({
            owner: address,
            coinType: ANAM01_TOKEN_TYPE,
        });
        const anamBalance = anamCoins.data.reduce((sum, coin) => sum + BigInt(coin.balance), 0n);

        console.log('\n📊 Saldo Saat Ini:');
        console.log(`- VRAM: ${(Number(vramBalance) / 1e9).toFixed(4)}`);
        console.log(`- ANAM01: ${anamBalance.toString()}`);

        return {
            vram: vramBalance,
            anam: anamBalance
        };
    } catch (error) {
        console.error('Gagal mendapatkan saldo:', error);
        return { vram: 0n, anam: 0n };
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function randomPercentage(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function calculatePercentageAmount(balance, percentage) {
    return (balance * BigInt(percentage)) / 100n;
}

async function main() {
    try {
        const client = new SuiClient({ url: SUI_NETWORK });
        global.client = client;

        const credentials = process.env.CREDENTIALS;
        if (!credentials) {
            throw new Error('CREDENTIALS not found in .env file');
        }

        try {
            global.keypair = getKeypair(credentials);
            console.log('🔑 Menggunakan private key');
        } catch {
            global.keypair = getKeypairFromMnemonic(credentials);
            console.log('🔑 Menggunakan mnemonic phrase');
        }

        const address = keypair.getPublicKey().toSuiAddress();
        global.address = address;
        console.log('👤 Address:', address);

        let transactionCount = 0;
        const MIN_VRAM_BALANCE = 1000000000; 
        while (true) {
            transactionCount++;
            console.log(`\n🔄 Transaksi #${transactionCount} dimulai...`);

            const balances = await showBalances();

            if (balances.vram < MIN_VRAM_BALANCE) {
                console.log('⚠️ Saldo VRAM tidak mencukupi, hentikan trading');
                break;
            }

            const action = Math.random() > 0.5 ? 'buy' : 'sell';

            try {
                if (action === 'buy') {
                    const percentage = randomPercentage(5, 12);
                    const amountVram = calculatePercentageAmount(balances.vram, percentage);

                    if (amountVram <= 0n) {
                        console.log('⏭️ Jumlah pembelian tidak valid, lewati');
                        continue;
                    }

                    const vramCoinId = await getCoinWithMinBalance(VRAM_TOKEN_TYPE, amountVram.toString());

                    if (!vramCoinId) {
                        console.log('⏭️ Tidak ada koin VRAM yang cukup, lewati pembelian');
                    } else {
                        await buyAnam01Token(amountVram, 0n, address, vramCoinId);
                    }

                } else { 
                    if (balances.anam <= 0n) {
                        console.log('⏭️ Saldo ANAM01 kosong, lewati penjualan');
                        continue;
                    }

                    const percentage = randomPercentage(5, 12);
                    let amountAnam = calculatePercentageAmount(balances.anam, percentage);

                    if (amountAnam <= 0n) amountAnam = 1n;

                    const anamCoinId = await getCoinWithMinBalance(ANAM01_TOKEN_TYPE, amountAnam.toString());

                    if (!anamCoinId) {
                        console.log('⏭️ Tidak ada koin ANAM01 yang cukup, lewati penjualan');
                    } else {
                        await sellAnam01Token(amountAnam, 0n, anamCoinId);
                    }
                }
            } catch (error) {
                console.error('❌ Kesalahan dalam eksekusi transaksi:', error.message);
            }

            const delayTime = Math.floor(Math.random() * 3000) + 5000;
            console.log(`⏳ Menunggu ${delayTime/1000} detik...`);
            await delay(delayTime);
        }

    } catch (error) {
        console.error('🚨 Error utama:', error.message);
    }
}

main();
