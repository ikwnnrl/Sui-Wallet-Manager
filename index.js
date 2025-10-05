/**
 * SUI Wallet Manager v34 (Menu Reorder)
 * ====================================
 * Skrip interaktif untuk manajemen dompet SUI.
 *
 * PERUBAHAN v34:
 * - Mengubah urutan menu, menempatkan "Ganti Jaringan" di Opsi 5.
 *
 * PERINGATAN: Gunakan dengan hati-hati. Pastikan private key Anda aman.
 */

const chalk = require("chalk");
const { SuiClient, getFullnodeUrl } = require("@mysten/sui.js/client");
const { Ed25519Keypair } = require("@mysten/sui.js/keypairs/ed25519");
const { TransactionBlock } = require("@mysten/sui.js/transactions");
const { decodeSuiPrivateKey } = require("@mysten/sui.js/cryptography");
const fs = require("fs");
const readline = require("readline");
const { ProxyAgent } = require("undici");

// ===================================================================================
// KONFIGURASI
// ===================================================================================
const PK_UTAMA_FILE = 'pk_utama.txt';
const ADDRESS_TUYUL_FILE = 'address_tuyul.txt';
const PK_TUYUL_FILE = 'pk_tuyul.txt';
const ADDRESS_UTAMA_FILE = 'address_utama.txt';
const USER_AGENTS_FILE = 'user_agents.txt';
const PROXY_FILE = 'proxy.txt';
const DELAY_MS = 10000;
const MIST_PER_SUI = 1_000_000_000;
const GAS_FEE_BUFFER_MIST = BigInt(10_000_000);

const FAUCET_URL = 'https://faucet.testnet.sui.io/v2/gas';
const FAUCET_RETRIES = 10;
const TRANSACTION_RETRIES = 10;
const RETRY_DELAY_MS = 5000;

// ===================================================================================
// INISIALISASI & FUNGSI UTILITAS
// ===================================================================================
let suiClient;
let selectedNetwork;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function readLinesFromFile(filename) {
    try {
        return fs.readFileSync(filename, 'utf-8').split('\n').filter(line => line.trim() !== '' && !line.startsWith('#'));
    } catch (error) {
        if (filename !== PROXY_FILE) {
            console.error(chalk.red(`\n❌ Gagal membaca file '${filename}'.`));
        }
        return [];
    }
}
async function selectAccount(file, type) {
    const accounts = readLinesFromFile(file);
    if (accounts.length === 0) {
        console.log(chalk.yellow(`\nFile ${file} kosong.`));
        return null;
    }
    if (accounts.length === 1) {
        return accounts[0];
    }
    console.log(chalk.yellow(`\nPilih ${type} dari file ${file}:`));
    accounts.forEach((acc, index) => {
        console.log(`${chalk.green(index + 1)}. ${acc.substring(0, 30)}...`);
    });
    return new Promise(resolve => {
        rl.question("Masukkan nomor: ", (choice) => {
            const index = parseInt(choice) - 1;
            if (index >= 0 && index < accounts.length) {
                resolve(accounts[index]);
            } else {
                console.log(chalk.red("Pilihan tidak valid."));
                resolve(null);
            }
        });
    });
}
async function executeTransactionWithRetries(keypair, txb) {
    for (let attempt = 1; attempt <= TRANSACTION_RETRIES; attempt++) {
        try {
            const result = await suiClient.signAndExecuteTransactionBlock({ signer: keypair, transactionBlock: txb });
            return { success: true, result, attempt };
        } catch (error) {
            console.error(chalk.red(`   - Gagal (percobaan ke-${attempt}/${TRANSACTION_RETRIES}): ${error.message.slice(0, 100)}...`));
            if (attempt < TRANSACTION_RETRIES) {
                console.log(chalk.gray(`   - Mencoba lagi dalam ${RETRY_DELAY_MS / 1000} detik...`));
                await sleep(RETRY_DELAY_MS);
            } else {
                return { success: false, error };
            }
        }
    }
}

// ===================================================================================
// FUNGSI INTI
// ===================================================================================
async function requestFromFaucet(address, userAgent, proxyString) {
    try {
        const fetchOptions = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent },
            body: JSON.stringify({ FixedAmountRequest: { recipient: address } }),
        };
        if (proxyString) {
            try {
                fetchOptions.dispatcher = new ProxyAgent(proxyString);
            } catch (e) {
                console.warn(chalk.yellow(`   Format proxy tidak valid: ${proxyString}. Mencoba tanpa proxy.`));
            }
        }
        const response = await fetch(FAUCET_URL, fetchOptions);
        const responseText = await response.text();
        if (response.status === 200) { 
            try {
                const data = JSON.parse(responseText);
                if (data.status?.Failure) {
                    return { success: false, error: data.status.Failure.Internal || "Error tidak diketahui dari Faucet" };
                }
                return { success: true, data };
            } catch (e) {
                return { success: false, error: "Respons sukses tapi bukan JSON valid." };
            }
        } else {
            try {
                const errorData = JSON.parse(responseText);
                if (errorData.status?.Failure) {
                    return { success: false, error: errorData.status.Failure.Internal };
                }
            } catch(e) {}
            return { success: false, error: responseText || `Gagal dengan status ${response.status}` };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function runFaucet(callback) {
    if (selectedNetwork !== 'testnet') {
        console.log(chalk.red("\n❌ Fitur Faucet hanya dapat digunakan di jaringan Testnet."));
        callback();
        return;
    }
    console.log(chalk.blue("\n--- Mulai Proses Auto Faucet ---"));
    const userAgents = readLinesFromFile(USER_AGENTS_FILE);
    if (userAgents.length === 0) {
        console.log(chalk.red(`File '${USER_AGENTS_FILE}' kosong. Proses dibatalkan.`));
        callback();
        return;
    }
    console.log(chalk.cyan(`✅ Berhasil memuat ${userAgents.length} User-Agent.`));
    const proxies = readLinesFromFile(PROXY_FILE);
    if (proxies.length > 0) {
        console.log(chalk.cyan(`✅ Berhasil memuat ${proxies.length} Proxy.`));
    } else {
        console.log(chalk.yellow("⚠️ File proxy kosong. Melanjutkan tanpa proxy."));
    }
    console.log(chalk.yellow(`Menargetkan dompet dari file: ${PK_TUYUL_FILE}`));
    const sourcePkStrings = readLinesFromFile(PK_TUYUL_FILE);
    if (sourcePkStrings.length === 0) { callback(); return; }
    let successCount = 0;
    let failCount = 0;
    for (let i = 0; i < sourcePkStrings.length; i++) {
        const pkString = sourcePkStrings[i].trim();
        let walletSuccess = false;
        try {
            const { secretKey } = decodeSuiPrivateKey(pkString);
            const keypair = Ed25519Keypair.fromSecretKey(secretKey);
            const address = keypair.getPublicKey().toSuiAddress();
            console.log(chalk.yellow(`\n[${i + 1}/${sourcePkStrings.length}] Memproses dompet ${address}...`));
            for (let attempt = 1; attempt <= FAUCET_RETRIES; attempt++) {
                const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
                const proxy = proxies.length > 0 ? proxies[i % proxies.length] : null;
                let logMessage = `   (Percobaan ke-${attempt}/${FAUCET_RETRIES}) Meminta SUI`;
                if (proxy) logMessage += ` via proxy ${proxy.split('@').pop()}`;
                console.log(chalk.gray(logMessage));
                const result = await requestFromFaucet(address, randomUserAgent, proxy);
                if (result.success) {
                    successCount++;
                    walletSuccess = true;
                    console.log(chalk.green(`   ✅ Berhasil!`));
                    break; 
                } else {
                    console.log(chalk.red(`   ❌ Gagal: ${result.error}`));
                    if (attempt < FAUCET_RETRIES) {
                        const retryDelay = Math.floor(Math.random() * 10000) + 1000;
                        console.log(chalk.gray(`      Mencoba lagi dalam ${retryDelay / 1000} detik...`));
                        await sleep(retryDelay);
                    }
                }
            }
            if (!walletSuccess) {
                failCount++;
                console.log(chalk.red.bold(`   Gagal mendapatkan faucet untuk dompet ini setelah ${FAUCET_RETRIES} percobaan.`));
            }
        } catch (error) {
            failCount++;
            console.error(chalk.red(`❌ Gagal memproses PK ke-${i+1}:`), error.message);
        }
        if (i < sourcePkStrings.length - 1) {
            const nextWalletDelay = Math.floor(Math.random() * 10000) + 20000;
            console.log(chalk.magenta(`\nJeda sebelum dompet berikutnya selama ${nextWalletDelay / 1000} detik...`));
            await sleep(nextWalletDelay);
        }
    }
    console.log(chalk.cyan("\n--- Ringkasan Faucet ---"));
    console.log(chalk.green(`Total Berhasil: ${successCount}`));
    console.log(chalk.red(`Total Gagal: ${failCount}`));
    console.log(chalk.bgGreen.bold("\n🎉 Proses faucet selesai. 🎉"));
    callback();
}

async function distributeSui(callback) {
    console.log(chalk.blue("\n--- Mulai Proses Sebar SUI ---"));
    const sourcePkString = await selectAccount(PK_UTAMA_FILE, "dompet utama (sumber)");
    if (!sourcePkString) { callback(); return; }
    const targetAddresses = readLinesFromFile(ADDRESS_TUYUL_FILE);
    if (targetAddresses.length === 0) { callback(); return; }
    const { secretKey } = decodeSuiPrivateKey(sourcePkString);
    const sourceKeypair = Ed25519Keypair.fromSecretKey(secretKey);
    const sourceAddress = sourceKeypair.getPublicKey().toSuiAddress();
    console.log(chalk.green(`\n➡️ Dompet Sumber: ${sourceAddress}`));
    console.log(chalk.green(`➡️ Ditemukan ${targetAddresses.length} alamat tujuan.`));
    rl.question(chalk.yellow("➡️ Masukkan jumlah SUI yang akan dikirim ke SETIAP dompet: "), async (amountInput) => {
        const amountPerWallet = parseFloat(amountInput);
        if (isNaN(amountPerWallet) || amountPerWallet <= 0) {
            console.error(chalk.red("\n❌ Input tidak valid. Masukkan angka positif."));
            callback();
            return;
        }
        const totalSuiRequired = amountPerWallet * targetAddresses.length;
        const amountPerWalletMIST = BigInt(Math.floor(amountPerWallet * MIST_PER_SUI));
        console.log(chalk.cyan(`\n⚙️ Anda akan mengirim ${amountPerWallet.toFixed(6)} SUI ke ${targetAddresses.length} dompet.`));
        console.log(chalk.cyan(`   Total SUI yang dibutuhkan: ${chalk.bold(totalSuiRequired.toFixed(6))} SUI`));
        const sourceBalanceResponse = await suiClient.getBalance({ owner: sourceAddress });
        const sourceBalance = parseInt(sourceBalanceResponse.totalBalance) / MIST_PER_SUI;
        if (sourceBalance < totalSuiRequired) {
            console.error(chalk.red(`\n❌ Saldo dompet sumber (${sourceBalance.toFixed(6)} SUI) tidak cukup.`));
            callback();
            return;
        }
        console.log(chalk.green(`   Saldo dompet sumber: ${sourceBalance.toFixed(6)} SUI. Saldo mencukupi.`));
        let totalSuccessfullySent = 0;
        console.log(chalk.magenta(`\n⏱️ Jeda antar transaksi: ${DELAY_MS / 1000} detik.`));
        console.log("Memulai proses...");
        for (let i = 0; i < targetAddresses.length; i++) {
            const targetAddress = targetAddresses[i].trim();
            console.log(chalk.yellow(`\n[${i + 1}/${targetAddresses.length}] Mengirim ${amountPerWallet.toFixed(6)} SUI ke ${targetAddress}...`));
            const txb = new TransactionBlock();
            const [coin] = txb.splitCoins(txb.gas, [amountPerWalletMIST]);
            txb.transferObjects([coin], targetAddress);
            const outcome = await executeTransactionWithRetries(sourceKeypair, txb);
            if (outcome.success) {
                console.log(chalk.green(`✅ Berhasil! (percobaan ke-${outcome.attempt}) Digest: ${outcome.result.digest}`));
                totalSuccessfullySent += amountPerWallet;
            } else {
                console.error(chalk.red(`❌ Gagal permanen mengirim ke ${targetAddress} setelah ${TRANSACTION_RETRIES} percobaan.`));
            }
            if (i < targetAddresses.length - 1) await sleep(DELAY_MS);
        }
        console.log(chalk.cyan("\n--- Ringkasan ---"));
        console.log(chalk.cyan(`Total Berhasil Disebar: ${chalk.bold.green(totalSuccessfullySent.toFixed(6))} SUI`));
        console.log(chalk.bgGreen.bold("\n🎉 Proses sebar SUI selesai. 🎉"));
        callback();
    });
}

async function consolidateSui(callback) {
    console.log(chalk.blue("\n--- Mulai Proses Kumpulkan SUI ---"));
    const destinationAddress = await selectAccount(ADDRESS_UTAMA_FILE, "dompet utama (tujuan)");
    if (!destinationAddress) { callback(); return; }
    const sourcePkStrings = readLinesFromFile(PK_TUYUL_FILE);
    if (sourcePkStrings.length === 0) { callback(); return; }
    rl.question(chalk.yellow("➡️ Masukkan jumlah SUI per dompet (kosongkan untuk kumpulkan semua): "), async (amountInput) => {
        const customAmount = amountInput.trim() === '' ? null : parseFloat(amountInput);
        if (customAmount !== null && (isNaN(customAmount) || customAmount <= 0)) {
            console.error(chalk.red("\n❌ Jumlah tidak valid."));
            callback();
            return;
        }
        const mode = customAmount === null ? "Kumpulkan Semua" : `Kumpulkan Custom (${customAmount} SUI)`;
        console.log(chalk.cyan(`\n➡️ Mode: ${mode}`));
        console.log(chalk.green(`➡️ Dompet Tujuan: ${destinationAddress}`));
        console.log(chalk.green(`➡️ Ditemukan ${sourcePkStrings.length} dompet sumber.`));
        console.log("Memulai proses...");
        let totalSuccessfullyCollected = 0;
        for (let i = 0; i < sourcePkStrings.length; i++) {
            const pkString = sourcePkStrings[i].trim();
            try {
                const { secretKey } = decodeSuiPrivateKey(pkString);
                const sourceKeypair = Ed25519Keypair.fromSecretKey(secretKey);
                const sourceAddress = sourceKeypair.getPublicKey().toSuiAddress();
                console.log(chalk.yellow(`\n[${i + 1}/${sourcePkStrings.length}] Memproses dompet ${sourceAddress}...`));
                const balanceResponse = await suiClient.getBalance({ owner: sourceAddress });
                const totalBalanceMist = BigInt(balanceResponse.totalBalance);
                let amountToTransferMist;
                if (customAmount === null) {
                    amountToTransferMist = totalBalanceMist - GAS_FEE_BUFFER_MIST;
                } else {
                    amountToTransferMist = BigInt(Math.floor(customAmount * MIST_PER_SUI));
                }
                if (amountToTransferMist <= 0) {
                    console.log(chalk.gray(`   Saldo tidak cukup untuk transfer, dilewati.`));
                    continue;
                }
                if (totalBalanceMist < amountToTransferMist) {
                     console.log(chalk.gray(`   Saldo tidak cukup untuk mengirim jumlah yang diminta, dilewati.`));
                    continue;
                }
                const txb = new TransactionBlock();
                const [coinToSend] = txb.splitCoins(txb.gas, [amountToTransferMist]);
                txb.transferObjects([coinToSend], destinationAddress);
                const outcome = await executeTransactionWithRetries(sourceKeypair, txb);
                if (outcome.success) {
                    const amountCollected = parseFloat(amountToTransferMist) / MIST_PER_SUI;
                    console.log(chalk.green(`✅ Berhasil! (percobaan ke-${outcome.attempt}) Mengirim ${amountCollected.toFixed(6)} SUI. Digest: ${outcome.result.digest}`));
                    totalSuccessfullyCollected += amountCollected;
                } else {
                    console.error(chalk.red(`❌ Gagal permanen memproses dompet ${sourceAddress} setelah ${TRANSACTION_RETRIES} percobaan.`));
                }
            } catch (error) {
                console.error(chalk.red(`❌ Gagal memproses PK ke-${i+1} (Error pra-transaksi):`), error.message);
            }
            if (i < sourcePkStrings.length - 1) await sleep(DELAY_MS);
        }
        console.log(chalk.cyan("\n--- Ringkasan ---"));
        console.log(chalk.cyan(`Total Berhasil Dikumpulkan: ${chalk.bold.green(totalSuccessfullyCollected.toFixed(6))} SUI`));
        console.log(chalk.bgGreen.bold("\n🎉 Proses kumpulkan SUI selesai. 🎉"));
        callback();
    });
}
async function checkBalances(callback) {
    console.log(chalk.blue("\n--- Mulai Proses Cek Saldo Gabungan ---"));
    async function processBalanceFile(filename, title, showTotal = false) {
        console.log(chalk.yellow(`\n--- ${title} ---`));
        const privateKeyStrings = readLinesFromFile(filename);
        if (privateKeyStrings.length === 0) {
            console.log(chalk.gray('   (File kosong atau tidak ditemukan)'));
            return;
        }
        let totalSuiBalance = 0;
        for (let i = 0; i < privateKeyStrings.length; i++) {
            const pkString = privateKeyStrings[i].trim();
            const indexStr = `${i + 1}.`.padEnd(4);
            try {
                const { secretKey } = decodeSuiPrivateKey(pkString);
                const keypair = Ed25519Keypair.fromSecretKey(secretKey);
                const address = keypair.getPublicKey().toSuiAddress();
                const balance = await suiClient.getBalance({ owner: address });
                const suiBalance = parseInt(balance.totalBalance) / MIST_PER_SUI;
                totalSuiBalance += suiBalance;
                const addressStr = address.padEnd(68);
                const balanceStr = suiBalance.toFixed(6).padStart(16);
                console.log(`${indexStr}${chalk.white(addressStr)}${chalk.green(balanceStr)} SUI`);
            } catch (error) {
                console.log(`${indexStr}${chalk.red('Gagal memproses PK, format salah.')}`);
            }
            await sleep(200);
        }
        if (showTotal) {
            const totalStr = "Total Saldo 'Tuyul':".padStart(72);
            const totalBalanceStr = totalSuiBalance.toFixed(6).padStart(16);
            console.log("-".repeat(93));
            console.log(`${totalStr}${chalk.bold.green(totalBalanceStr)} SUI`);
        }
    }
    await processBalanceFile(PK_UTAMA_FILE, "Saldo Dompet dari: pk_utama.txt");
    await processBalanceFile(PK_TUYUL_FILE, "Saldo Dompet dari: pk_tuyul.txt", true);
    console.log(chalk.bgGreen.bold("\n🎉 Proses pengecekan saldo selesai. 🎉"));
    callback();
}


// ===================================================================================
// FUNGSI UTAMA (Main Menu)
// ===================================================================================
function selectNetwork() {
    return new Promise(resolve => {
        const showPrompt = () => {
            console.log(chalk.cyan("\n==================================================="));
            console.log(chalk.cyan(`        Pilih Jaringan yang akan Digunakan`));
            console.log(chalk.cyan("==================================================="));
            console.log("");
            console.log(`1. Mainnet ${chalk.red.bold('(UANG SUNGGUHAN - SANGAT HATI-HATI!)')}`);
            console.log(`2. Testnet ${chalk.green.bold('(AMAN UNTUK UJI COBA)')}`);
            console.log("");
            console.log(chalk.cyan("---------------------------------------------------"));

            rl.question(chalk.yellow("Masukkan pilihan (1-2): "), (choice) => {
                if (choice.trim() === '1') {
                    console.log(chalk.bgRed.white.bold("\n⚠️ ANDA MEMILIH MAINNET. SEMUA TRANSAKSI MENGGUNAKAN UANG SUNGGUHAN! ⚠️"));
                    resolve('mainnet');
                } else if (choice.trim() === '2') {
                    console.log(chalk.bgGreen.black.bold("\n✅ Anda memilih Testnet. Mode aman untuk uji coba. ✅"));
                    resolve('testnet');
                } else {
                    console.log(chalk.red("\nPilihan tidak valid. Silakan coba lagi."));
                    showPrompt();
                }
            });
        };
        showPrompt();
    });
}

// [PERUBAHAN] Urutan menu diubah
function showMenu() {
    const title = "SUI Wallet Manager";
    const byline = "by iwwwit";
    const network = `Jaringan: ${selectedNetwork.toUpperCase() === 'MAINNET' ? chalk.red.bold(selectedNetwork.toUpperCase()) : chalk.yellow(selectedNetwork.toUpperCase())}`;

    console.log(chalk.cyan("\n================================================="));
    console.log(chalk.cyan(`          ${chalk.bold.blue(title)}`));
    console.log(chalk.cyan(`             ${chalk.gray(byline)}`));
    console.log(chalk.cyan(`${network}`));
    console.log(chalk.cyan("================================================="));
    console.log("Pilih Opsi:");
    console.log("1. Sebar SUI (Utama -> Tuyul)");
    console.log("2. Kumpulkan SUI (Tuyul -> Utama)");
    console.log("3. Cek Saldo (Utama & Tuyul)");
    console.log("4. Minta SUI dari Faucet (Testnet)");
    console.log("5. Ganti Jaringan"); // Opsi baru
    console.log("6. Keluar"); // Opsi keluar digeser
    console.log(chalk.cyan("-------------------------------------------------"));

    rl.question(chalk.yellow("Masukkan pilihan Anda (1-6): "), (choice) => {
        switch (choice.trim()) {
            case '1': distributeSui(showMenu); break;
            case '2': consolidateSui(showMenu); break;
            case '3': checkBalances(showMenu); break;
            case '4': runFaucet(showMenu); break;
            case '5': 
                console.log(chalk.yellow("\nKembali ke pemilihan jaringan..."));
                start(); 
                break; 
            case '6': 
                console.log(chalk.blue("\n👋 Sampai jumpa!")); 
                rl.close(); 
                break;
            default: console.log(chalk.red("\n❌ Pilihan tidak valid.\n")); showMenu(); break;
        }
    });
}

async function start() {
    console.log("\n=== Selamat datang di SUI Wallet Manager ===");
    selectedNetwork = await selectNetwork();
    
    suiClient = new SuiClient({ url: getFullnodeUrl(selectedNetwork) });
    
    showMenu();
}

start();