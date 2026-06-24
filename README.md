# UNO by Ryuu v1.2 — UI/UX Game Room Polish

Versi ini hanya memperbaiki tampilan/UX sesuai arahan terakhir tanpa mengubah gameplay dan fitur utama yang sudah berjalan.

## Perbaikan

- Tampilan saat bermain dibuat lebih rapi untuk HP dan laptop.
- Saat sudah masuk room, menu utama/sidebar seperti Home, Room, Profile, Logout disembunyikan agar tidak menumpuk.
- Game room dibuat fokus ke arena, player/chat/log/power, dan kartu pemain.
- Layout HP dibuat compact agar lebih enak dimainkan dan tidak ribet.
- Animasi kartu masuk ke tengah saat kartu dimainkan.
- Animasi/pesan saat tidak ada kartu yang cocok atau kartu tidak bisa dimainkan.
- Musik, voice, login, room, shop, inventory, friends, leaderboard, reconnect, dan fitur lain tetap dipertahankan.

## Deploy Railway

Upload isi folder ini ke repo GitHub, lalu Railway akan redeploy otomatis.

Struktur repo:

```text
repo/
├── public/
│   ├── index.html
│   ├── style.css
│   ├── client.js
│   └── assets/
├── package.json
├── railway.json
├── Dockerfile
├── README.md
└── server.js
```

Jangan upload sebagai folder ganda.


## v1.3 Music Audio Fix

Patch khusus: mengembalikan suara music player tanpa mengubah gameplay/fitur lain. YouTube player sekarang dipindahkan ke audio host kecil di luar panel yang bisa di-hide, sehingga suara tidak ikut mati ketika UI game/room dipoles. Volume user tetap lokal dan musik host tidak restart saat turn berganti.


## v1.4 Room Music + Voice Fix
- Memperbaiki tombol Room music host yang kadang tidak muncul/berfungsi setelah masuk room.
- Memaksa sync musik host setelah Play Room agar tidak kosong.
- Mengembalikan binding Join Voice/Leave Voice dan memperkuat koneksi WebRTC antar pemain.
- Daftar voice dikirim ke seluruh room agar semua pemain tahu siapa yang sedang voice.
