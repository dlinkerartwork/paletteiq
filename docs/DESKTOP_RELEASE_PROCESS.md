# Desktop release checklist

Gunakan checklist ini sebelum menerbitkan installer Windows PaletteIQ Desktop.

1. Perbarui `version` dalam `package.json` untuk rilis baru.
2. Tambahkan entri versi baru paling atas di `CHANGELOG.md` dengan format `## [x.y.z] - YYYY-MM-DD`.
3. Isi ringkasan fitur, perbaikan, perubahan perilaku, hal yang perlu diperhatikan, dan langkah upgrade. Jelaskan perubahan data atau konfigurasi jika ada.
4. Jalankan `npm run typecheck` dan `npm run test:production`.
5. Build installer sesuai edisi:
   - Standar: `npm run desktop:package:win`
   - Tanpa lisensi: `npm run desktop:package:win:no-license`
6. Build akan **gagal** jika tidak ada catatan perubahan untuk versi yang sama dengan `package.json`.
7. Publikasikan berkas `release/PaletteIQ-Release-Notes-x.y.z.md` bersama installer `.exe` pada halaman GitHub Release atau kanal distribusi lainnya.
8. Verifikasi bahwa `RELEASE_NOTES.md` dan `CHANGELOG.md` tersedia di direktori `resources/paletteiq-runtime` dalam paket Windows.
9. Uji install baru dan upgrade dari versi sebelumnya. Cadangkan data dan selesaikan pekerjaan background sebelum upgrade.

Catatan: Fitur ini membuat **dokumentasi pembaruan**, bukan mekanisme auto-update aplikasi. Rilis hanya dianggap siap setelah pemeriksaan installer dan isi dokumen selesai.
