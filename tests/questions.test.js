// C# sual bankının yoxlanışı (server/data/csharp-questions.json). İşə salmaq: node tests/questions.test.js
const path = require('path');
const Q = require(path.join(__dirname, '..', 'server', 'data', 'csharp-questions.json'));
let pass = 0, fail = 0;
const ok = (name, cond, info = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'} - ${name} ${info}`); };

ok('bankda ən azı 120 sual var', Q.length >= 120, String(Q.length));
ok('hər sualın id-si tam ədəd və unikaldır', Q.every((q) => Number.isInteger(q.id)) && new Set(Q.map((q) => q.id)).size === Q.length);
ok('sual mətnləri təkrarlanmır', new Set(Q.map((q) => q.q.trim().toLowerCase())).size === Q.length);
const badOpt = Q.filter((q) => !Array.isArray(q.o) || q.o.length !== 3 || new Set(q.o).size !== 3 || q.o.some((o) => typeof o !== 'string' || !o.trim()));
ok('hər sualın 3 fərqli, boş olmayan variantı var', !badOpt.length, badOpt.map((q) => q.id).join(','));
const badC = Q.filter((q) => !(Number.isInteger(q.c) && q.c >= 0 && q.c <= 2));
ok('düzgün cavab indeksi 0..2 aralığındadır', !badC.length, badC.map((q) => q.id).join(','));
const topics = new Set(Q.map((q) => q.topic));
const need = ['tiplər', 'operatorlar', 'şərtlər', 'dövrlər', 'massivlər', 'string', 'metodlar', 'OOP', 'interfeys', 'exception', 'LINQ', 'async'];
ok('bütün mövzular var', need.every((t) => topics.has(t)), need.filter((t) => !topics.has(t)).join(','));
ok('hər mövzuda ən azı 5 sual var', need.every((t) => Q.filter((q) => q.topic === t).length >= 5));
const dist = [0, 1, 2].map((k) => Q.filter((q) => q.c === k).length);
ok('düzgün cavablar mövqelərə təxminən bərabər paylanıb', Math.max(...dist) - Math.min(...dist) <= Q.length * 0.2, dist.join('/'));
ok('suallar Azərbaycan dilindədir (ə, ı, ş, ç, ğ, ö, ü hərfləri)', Q.filter((q) => /[əışçğöü]/i.test(q.q)).length > Q.length * 0.7);

console.log(`\n${pass}/${pass + fail} keçdi`);
process.exit(fail ? 1 : 0);
