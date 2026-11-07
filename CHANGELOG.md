# PaletteIQ Desktop — Software Update History

Release notes ini menjadi catatan perubahan resmi untuk setiap versi installer Windows (berlisensi dan tanpa lisensi).

## [0.1.0] - 2026-11-07

### Fitur
- Aplikasi desktop Windows dengan runtime Node.js yang disertakan di installer; pengguna tidak perlu memasang Node.js secara terpisah.
- Tersedia pilihan installer standar dan NoLicense.
- Workspace produksi clipart, pengelolaan collection, image generation, dan ekspor aset.
- Pengaturan pola nama file ekspor gambar, termasuk pola `charactername_imagenumber`.

### Perbaikan dan stabilitas
- Penguatan alur pekerjaan background dan pemulihan batch generation.
- Perbaikan proses upgrade Windows agar tetap menggunakan identitas aplikasi yang sama.

### Petunjuk upgrade
1. Selesaikan atau hentikan pekerjaan generate yang sedang berjalan sebelum memulai installer.
2. Cadangkan data penting sebelum upgrade.
3. Tutup PaletteIQ Desktop, lalu jalankan installer versi baru.
4. Instal ke lokasi aplikasi yang sama. Biasanya tidak perlu uninstall versi sebelumnya.
5. Jalankan aplikasi dan periksa kembali data, konfigurasi, serta antrean pekerjaan.

### Catatan
- Installer tidak ditandatangani dengan sertifikat code-signing jika sertifikat belum dikonfigurasi; Windows dapat menampilkan peringatan.
- Upgrade aplikasi bukan pengganti backup data.
