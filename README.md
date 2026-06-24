# UNO by Ryuu Final

Game kartu UNO-style realtime berbasis Node.js + Express + Socket.IO.

## Fitur Final

- Login dan daftar akun pakai username + PIN
- Username unik, kalau sudah dipakai harus login
- Akun owner bawaan: `ryuu` / `291206` dengan poin unlimited
- Profil pemain, upload foto profil, statistik, poin
- Leaderboard Top 100
- Public Lobby, room list, room password
- Reconnect room berbasis akun
- Room persistent via `data/rooms.json`
- Akun, inventory, poin, friends persistent via `data/players.json`
- Shop skin, badge, frame, card back, table theme
- Inventory dan equip item
- Power item sekali pakai: Draw Shield, Double Points, UNO Guard
- Open Crate / gacha dengan rarity Common, Rare, Epic, Legendary, Mythic
- Friends system, request teman, invite teman ke lobby
- Chat room
- Shared music YouTube: host cari lagu dan play ke room
- Voice room WebRTC + daftar siapa yang sedang voice
- Animasi turn, win, crate opening, toast reward
- UI responsive HP dan laptop

## Cara Deploy Railway

1. Upload isi folder ini ke GitHub repo.
2. Railway → New Project → Deploy from GitHub.
3. Pastikan service memakai Node.js 22.
4. Generate Domain di Railway untuk HTTPS.
5. Tambahkan Volume agar data tidak hilang:

```text
Mount Path: /app/data
```

Data tersimpan di:

```text
/app/data/players.json
/app/data/rooms.json
```

## Cara Main

1. Login / daftar akun.
2. Buat room atau join dari Public Lobby.
3. Host klik Mulai Game.
4. Mainkan kartu dengan warna/angka/simbol yang cocok.
5. Tekan UNO saat kartu tinggal satu.
6. Pemain lain bisa Challenge kalau ada yang lupa UNO.
7. Shop, Inventory, Crates, Friends, Voice, dan Music tersedia sebagai fitur pendukung.

## Catatan Musik dan Voice

- Untuk voice di HP, gunakan link HTTPS dari Railway.
- YouTube player memakai embed; beberapa video bisa menolak embed. Kalau tidak bunyi, pilih hasil lagu lain.
- Browser HP kadang butuh tombol “Aktifkan HP” sebelum audio bisa terdengar.


## v1.1 Music Sync Fix

Perbaikan khusus musik tanpa mengubah gameplay UNO:

- Lagu host tidak restart lagi saat giliran berpindah.
- Semua pemain bisa mengatur volume sendiri dari slider.
- Sebelum masuk room, semua user bisa cari dan play lagu sendiri.
- Di dalam room, host bisa memutar musik untuk seluruh room.
- Pemain bisa memilih mode **Dengar Host** atau **Streaming Sendiri**.
- Tombol music di laptop bisa diklik normal dan tetap bisa digeser lewat tombol kecil.

Cara pakai singkat:

1. Klik tombol ♪.
2. Cari lagu YouTube.
3. Klik **Play** untuk dengar sendiri.
4. Host klik **Room** agar semua room mendengar lagu yang sama.
5. Pemain bisa atur volume masing-masing.
6. Pemain yang tidak mau mendengar host bisa pilih **Streaming Sendiri** lalu play lagu pilihannya.
