# BMU Online (prototip v0.1)

Brauzerdə işləyən, Bakı Mühəndislik Universitetinin kampusunda keçən multiplayer oyun.

## İşə salmaq
`start.bat` faylına iki dəfə kliklə və ya:

```
npm install
npm start
```

Sonra brauzerdə `http://localhost:3000` aç. Eyni Wi-Fi-dakı dostlar `http://<sənin-IP>:3000` ilə qoşula bilər
(IP-ni `ipconfig` göstərir; Windows Firewall icazə istəyə bilər).

## Hazır olanlar
- Ad + PIN ilə giriş (hesab avtomatik yaradılır), məlumatlar `data/players.json`-da saxlanılır
- Xarakter yaratma (6 bölmə): 8 hazır obraz, bədən (boy, çəki, əzələ, ayaq, baş), üz (forma, göz, qaş, burun, ağız, dodaq, yanaq, saqqal),
  13 saç düzümü, 7 üst geyim + naxışlar, 5 alt geyim, 3 ayaqqabı, papaq/eynək/çanta/sırğa/boyun aksesuarları.
  Önizləmə şəkilləri, geri al/irəli al (Ctrl+Z/Y), bölmə üzrə və tam təsadüfi, pozalar. İstənilən vaxt **C** ilə dəyişmək
- Kişi və qadın bədəni fərqlidir (çiyin, bel, omba, sinə, çənə, kirpik, dodaq)
- Emosiyalar: 1 əl yelləmək, 2 rəqs, 3 sevinc (hamı görür, NPC-lər də edir)
- Döyüş: **G** yumruq/tapança, **klik** vur, **R** doldur (12 güllə). 100 can, 5 san sonra bərpa olunur.
  Tapança 22 zərər (başa 55), yumruq 12. Ölən 6 san sonra uzaqda doğulur, 3 san qorunur; öldürən +25 XP (NPC üçün +10).
  Vurulan NPC qaçır. İsabəti server hesablayır (divar arxasından vurmaq olmur). Rəqəmlər `server.js` → `W`
- Qrafika: qradiyentli səma, buludlar, ACES ton xəritələmə, iti kölgələr, daş yollar, kollar, çiçəklər, fənərlər, ot,
  fasadlarda çərçivəli pəncərələr, əsas korpusda sütunlu giriş. **P** — foto rejimi; ⚙ Ayarlar → keyfiyyət (Yüksək/Aşağı)
- Sabit NPC-lər `campus.json` → `npcs` (məs. dar ağacının yanında "Meydandayıq" deyən Rəhman)
- Hicab (Aksesuar → Baş), "Mühəndis qız" hazır obrazı
- Dar ağacı (kitabxananın cənub-şərqi): yaxınlaşıb **F** → "Yeni məhkum yarat". Məhkum uydurma NPC-dir —
  görünüşü redaktorda qurulur, adı `options.json`-dakı `dummyNames` siyahısından seçilir (real oyunçular çəkilmir,
  sərbəst ad yazılmır). 3 yer, 2 dəqiqə qalır, istənilən oyunçu azad edə bilər
- Kamera: siçanı basıb sürüşdür və ya klikləyib kilidlə; Q/E; həssaslıq ayarı; kamera binalara girmir
- Kampus (təxmini düzüm): Əsas korpus, Yeni tədris korpusu, Kitabxana, İdman zalı, Yataqxana, Texnopark, Yeməkxana, futbol meydançası, fəvvarəli meydan, dayanacaq
- Multiplayer: bir-birini görmək, çat (Enter)
- Oyundan çıxan oyunçunun xarakteri kampusda **NPC kimi gəzməyə davam edir**, geri girəndə oradan davam edirsən
- Gəzdikcə XP və level

## Fayllar
- `server/server.js` — server, hesablar, NPC süni intellekti
- `public/data/campus.json` — xəritə (binaların yeri/ölçüsü, yollar) — şəkillərə görə burada dəqiqləşdirilir
- `public/data/options.json` — xarakter seçimləri
- `public/js/character.js` — xarakter modeli, `world.js` — kampus, `creator.js` — redaktor, `main.js` — oyun

## Növbəti mərhələlər
1. Döyüş: silah, sağlamlıq, öldürmə, respawn
2. Binaların içi (dərs otaqları, kitabxana)
3. Mini-oyunlar (futbol, viktorina, yarış), tapşırıqlar, XP mükafatları
4. Əsl kampusa uyğun xəritə (şəkillər əsasında)
5. Sonra: Godot/Unity-yə keçid
