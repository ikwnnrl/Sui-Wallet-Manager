# 🪙 SUI Wallet Manager 

Skrip **interaktif Node.js** untuk mengelola banyak dompet **SUI** secara otomatis — termasuk distribusi SUI, pengumpulan saldo, pengecekan saldo, dan permintaan faucet di jaringan testnet.

---

## 🚀 Fitur Utama
- **Sebar SUI (Main → Tuyul)**  
  Kirim sejumlah SUI tertentu dari dompet utama ke banyak dompet tuyul.
- **Kumpulkan SUI (Tuyul → Main)**  
  Kumpulkan saldo dari banyak dompet tuyul ke dompet utama.
- **Cek Saldo Gabungan**  
  Menampilkan saldo seluruh dompet yang tersimpan dalam file `pk_utama.txt` dan `pk_tuyul.txt`.
- **Auto Faucet (Testnet Only)**  
  Meminta SUI secara otomatis dari faucet testnet untuk setiap dompet tuyul menggunakan *user-agent* dan *proxy* acak.
- **Ganti Jaringan (Mainnet/Testnet)**  
  Pilih jaringan sebelum menjalankan operasi.
- **Retry Otomatis dan Delay Acak**  
  Setiap transaksi memiliki sistem percobaan ulang otomatis dan jeda antar dompet untuk menghindari limitasi jaringan.

---

## ⚙️ Persyaratan

### 1. Instalasi Modul
Pastikan Node.js versi 18+ telah terinstal, lalu jalankan:
```bash
npm install chalk @mysten/sui.js undici
```

### 2. Struktur File
Buat file teks berikut di folder yang sama dengan `index.js`:

| File | Keterangan |
|------|-------------|
| `pk_utama.txt` | Private key dompet utama (sumber SUI). |
| `address_utama.txt` | Address dompet utama untuk menerima hasil pengumpulan. |
| `pk_tuyul.txt` | Private key dompet tuyul (target distribusi / sumber pengumpulan). |
| `address_tuyul.txt` | Daftar address tuyul. |
| `user_agents.txt` | Daftar *user-agent* (1 per baris) untuk mode faucet. |
| `proxy.txt` | (Opsional) Daftar proxy HTTP/SOCKS dalam format `http://user:pass@host:port`. |

---

## 📄 Contoh Isi File Konfigurasi

### `pk_utama.txt`
```
suiprivkey1qwerty1234567890abcdefghijklmno
```

### `address_utama.txt`
```
0xabc1234567890defabcdef1234567890abcdef12
```

### `pk_tuyul.txt`
```
suiprivkey1asdfgh1234567890qwertyuiopzxcvbn
suiprivkey1qazwsxedcrfvtgbyhnujmikolp098765
suiprivkey1poiuytrewqlkjhgfdsamnbvcxz123456
```

### `address_tuyul.txt`
```
0x123abc456def789ghi012jkl345mno678pqr901
0xaaa111bbb222ccc333ddd444eee555fff666ggg
0x987zyx654wvu321tsr098qpo765nml432kji109
```

### `user_agents.txt`
```
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Safari/605.1.15
Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Mobile Safari/537.36
```

### `proxy.txt`
```
http://user:password@123.45.67.89:8080
http://user:password@111.22.33.44:3128
socks5://user:password@98.76.54.32:1080
```

---

## 🧩 Cara Menjalankan

1. Jalankan skrip:
   ```bash
   node index.js
   ```
2. Pilih jaringan (`Mainnet` atau `Testnet`).
3. Gunakan menu yang tersedia:
   ```
   1. Sebar SUI
   2. Kumpulkan SUI
   3. Cek Saldo
   4. Minta SUI dari Faucet
   5. Ganti Jaringan
   6. Keluar
   ```

---

## 🧠 Catatan Teknis
- Nilai 1 SUI = `1_000_000_000` mist.  
- Transaksi dikirim menggunakan `@mysten/sui.js` melalui `SuiClient` dan `TransactionBlock`.
- Otomatis retry hingga `10x` untuk setiap transaksi yang gagal.
- Jeda antar transaksi default: `10 detik` (`DELAY_MS = 10000`).

---

## ⚠️ Peringatan
> - **Jangan pernah membagikan file private key (`pk_utama.txt`, `pk_tuyul.txt`) ke siapa pun.**  
> - Gunakan **Mainnet dengan sangat hati-hati** — semua transaksi nyata menggunakan dana sungguhan.  
> - Untuk uji coba, gunakan **Testnet** agar aman.  
> - Gunakan proxy dan user-agent unik saat melakukan auto faucet agar tidak terkena limit.

---

## 👨‍💻 Pembuat
**SUI Wallet Manager v34**  
Dibuat oleh: **iwwwit**  
Lisensi: **MIT License**
