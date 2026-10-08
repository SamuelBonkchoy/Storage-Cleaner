# Storage Audit & Cleaner ⚡

> **Pembersihan Storage Riil di Harddisk Komputer**  
> Utilitas audit dan pembersih penyimpanan lokal berbasis **Node.js** dan **Python** menggunakan runtime bawaan (**Zero npm install / Zero pip install**).

---

## 📸 Tampilan Antarmuka (Sesuai Desain & SRS)

Aplikasi ini menyajikan dashboard modern, responsif, dan interaktif yang menyerupai antarmuka profesional:
- **Header Status**: Indikator *Direct Execution*, tombol *Pindai Ulang*, dan tombol aksi *Bersihkan Duplikat & Sampah*.
- **Target Harddisk Aktif**: Menampilkan path folder fisik yang sedang dianalisis secara dinamis (default: `./Bahan Latihan P12`), dilengkapi tombol *Browse Folder (Dialog OS)*, *Pilih / Upload Folder*, dan *Input Path*.
- **4 Kartu Metrik Storage**:
  1. **TOTAL FILE DI-SCAN**: Jumlah total file yang dipindai secara rekursif.
  2. **TOTAL KAPASITAS FOLDER**: Ukuran data fisik asli di disk (dalam MB).
  3. **FILE RAKSASA (≥ 2 MB)**: Jumlah file yang ukurannya melebihi ambang batas 2.048 KB (2 MB).
  4. **POTENSI HEMAT RUANG**: Estimasi kuota penyimpanan yang dapat dipulihkan dari duplikat dan file `.tmp`.
- **Daftar File Raksasa (≥ 2 MB)**: Tabel daftar file boros kuota lengkap dengan nama, path harddisk, ukuran dalam MB/KB, dan badge format file (PDF, ZIP, PPTX, MP4, dll.), disertai kolom pencarian cepat.
- **Kelompok File Duplikat (SHA-256 Identik)**: Accordion interaktif yang mengelompokkan file-file dengan hash SHA-256 identik (meskipun namanya berbeda), membedakan **Master (Dipertahankan)** dan **Salinan Kembar (Siap Dihapus)**.
- **Modal Konfirmasi Interaktif**: Dialog peringatan sebelum eksekusi pembersihan dengan rincian jumlah duplikat, file `.tmp`, total file, dan ruang disk yang akan dipulihkan, disertai *Garansi Keamanan* (1 file master asli per kelompok selalu dipertahankan).

---

## 🚀 Cara Menjalankan

### Opsi 1: Menggunakan Node.js (Rekomendasi Utama)
Pastikan Node.js terpasang di komputer (skrip hanya menggunakan modul native: `http`, `fs`, `path`, `crypto`, `child_process`). **Tidak memerlukan `npm install`**.

```bash
node storage_audit.js
```
*Skrip akan otomatis membuka dashboard di browser (`http://localhost:3000`).*

### Opsi 2: Menggunakan Python
Jika komputer Anda memiliki runtime Python 3:

```bash
python storage_audit.py
```
*Menggunakan library bawaan Python (`http.server`, `os`, `hashlib`, `webbrowser`, dll.) tanpa perlu `pip install`.*

---

## 🛠️ Spesifikasi Kebutuhan Sistem (SRS) yang Diimplementasikan

| No | Kebutuhan SRS | Implementasi |
|---|---|---|
| **STG-01** | Input path folder dinamis (default: `./Bahan Latihan P12`), memindai subfolder secara rekursif, mengumpulkan nama, path absolut, ukuran byte, dan hash SHA-256. | ✅ Endpoint `/api/scan?path=...` memindai seluruh direktori secara rekursif dan menghitung SHA-256 stream untuk setiap file. |
| **STG-02** | Mengelompokkan file dengan hash SHA-256 identik (isi sama persis) meskipun nama berbeda. | ✅ Mengelompokkan duplikat ke dalam daftar grup dengan penandaan 1 master asli dan salinannya. |
| **STG-03** | Menandai file berukuran ≥ 2 MB (2.048 KB) sebagai *File Raksasa*. | ✅ Filter file berukuran ≥ 2 MB dan ditampilkan dalam tabel file raksasa terurut berdasarkan ukuran terbesar. |
| **STG-04** | Dashboard responsif di `http://localhost:3000` dengan 4 kartu metrik, tabel file raksasa, dan accordion duplikat. | ✅ Tampilan single-page web responsif dengan tema dark mode premium yang identik dengan desain referensi. |
| **STG-05** | Tombol *Bersihkan Duplikat & Sampah* dengan modal konfirmasi interaktif, berdampak langsung pada harddisk asli (*in-place execution*), menghapus salinan kembar & file `.tmp`, serta mempertahankan 1 master. | ✅ Endpoint `/api/clean` mengeksekusi penghapusan fisik `fs.unlinkSync()`, menjaga file master, dan memperbarui metrik storage seketika. |
| **STG-06** | File tunggal mandiri tanpa dependensi eksternal, otomatis membuka browser. | ✅ Berjalan mandiri dengan `node storage_audit.js`. |