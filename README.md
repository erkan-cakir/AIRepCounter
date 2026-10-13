# AI RepCounter v0.1 — iPhone Sensor Lab

React + TypeScript + Vite ile geliştirilmiş, iPhone Safari üzerinden DeviceMotion / DeviceOrientation verilerini toplayan ilk prototip.

## Windows kurulumu

1. Node.js LTS kur: https://nodejs.org/
2. ZIP dosyasını bir klasöre çıkart.
3. Klasörde terminal (PowerShell) aç:

```powershell
npm install
npm run dev
```

4. Windows tarayıcısında `http://localhost:5173` adresini açarak arayüzü kontrol et. **Windows'taki bu adres iPhone sensörlerini okumaz.**

## iPhone ile test: HTTPS zorunlu

En kolay yöntem, projeyi GitHub'a yükleyip Vercel'de dağıtmaktır:

1. GitHub'da yeni bir repo aç ve proje dosyalarını yükle (`node_modules` hariç).
2. https://vercel.com/new üzerinden GitHub reposunu içe aktar.
3. Framework Vite; build command `npm run build`; output directory `dist`.
4. Vercel'in verdiği `https://...vercel.app` adresini **iPhone Safari** ile aç.
5. "Sensör erişimine izin ver" düğmesine dokun ve izin ver.
6. Telefonu hareket ettir; X/Y/Z değerlerinin değiştiğini doğrula.
7. Egzersiz ve telefon konumunu seç; kaydı başlat, hareketi yap, durdur ve CSV indir.

Not: Safari Ayarlar > Safari > Hareket ve Yönelim Erişimi (iOS sürümüne göre menü adı değişebilir) kapalıysa açman gerekebilir. Safari'nin sensör desteği, izin davranışı ve olay hızı cihaz/iOS sürümüne göre değişir. HTTPS'de bile veri gelmeyebilir; bu durumda gerçek iPhone ve Safari üzerinde izin/ayar kontrolü yapılmalıdır.

## CSV sütunları

`timestamp,elapsed_ms,exercise,placement,ax,ay,az,gx,gy,gz,alpha,beta,gamma`

İvme `accelerationIncludingGravity` değerlerinden m/s²; dönüş hızı `rotationRate` alanlarından tarayıcının bildirdiği birimlerle alınır (standartta °/sn). Boş alan sensörün o veriyi vermediğini gösterir. Cihaz konumuna göre eksen kalibrasyonu gereklidir.

## Veri toplama önerisi

Her hareket için telefon yerleşimini sabitle; her biri için 3 set x 10 tekrar uygula. Setleri ayrı CSV kaydet. Hareket öncesi 3 saniye hareketsiz dur, 10 tekrar yap, ardından 3 saniye bekle. Veriyi doğru/hatalı tekrar olarak etiketlemek için ayrıca not tut. Egzersiz otomatik tanıma, tekrar sayma ve form doğrulama **henüz uygulanmadı**.

## Önemli sınırlar

- iPhone Safari sensör örnekleme sıklığını garanti etmez; olaylar geldikçe kaydeder.
- Ekran kilitliyken/arka planda sensör akışı kesilebilir. Test boyunca ekran açık kalsın.
- Sayfa yenilenirse bellekteki veriler silinir. Önce CSV indir.
- Tek telefonla iki kolun simetrisi ve tüm eklem açıları kesin ölçülemez.
- İvme/jyro verileri kaydedilmeden sunucuya gönderilmez; CSV kullanıcı tarafından indirilir.
