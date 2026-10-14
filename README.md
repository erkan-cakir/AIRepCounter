# AI RepCounter v0.5

Mobil tarayıcı hareket ve yön sensörleriyle ham veri toplayan React/TypeScript Vite PWA prototipi.

## v0.5 kapsamı

- iPhone Safari için kullanıcı etkileşimli `DeviceMotion` ve `DeviceOrientation` izni
- Ham ivme, dönüş hızı ve yönelim verisinin CSV kaydı
- Biceps Curl için kullanıcı başlatmalı kişisel kalibrasyon
- Açısal sarmalanma düzeltmesi, üstel yumuşatma, gürültü tabanı ve histerezis
- Tam/yarım hareket adaylarının ayrı sayılması
- Açı, süre, karar ve kabul gerekçeli hareket günlüğü
- Her 10 geçerli tekrar için 1 set ve 3 set hedefi
- Destekleyen cihazlarda açılıp kapatılabilen tekrar/set titreşimi; iOS Safari için görsel geri bildirim
- Kayıt durduktan sonra da kalan egzersiz, tekrar, set ve süre özeti
- Sensör akışını kesmeden çalışan mobil büyük sayaç odak modu
- Diğer dört egzersizde yalnızca veri toplama modu
- PWA manifesti ve çevrimdışı uygulama kabuğu

> Bu prototip eğitilmiş AI modeli kullanmaz ve form doğruluk puanı üretmez. Eşikler deneyseldir.

## Yerel çalışma

```bash
npm install
npm run dev
```

Üretim doğrulaması:

```bash
npm run build
npm run preview
```

iPhone sensör izinleri için site HTTPS üzerinden açılmalıdır. Vercel gibi HTTPS sağlayan bir platform kullanılabilir.
