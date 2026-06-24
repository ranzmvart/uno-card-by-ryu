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
