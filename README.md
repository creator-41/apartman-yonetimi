# Komşu · Apartman Yönetimi

GitHub Pages üzerinde çalışan, Acısu United'ın mevcut Supabase projesine bağlı apartman yönetimi uygulaması. Ayrıca sunucu, SQLite veya yeni Supabase projesi gerektirmez.

## Kullanım

- **Giderler → Düzenle:** Giderin kategorisi, açıklaması, tutarı ve tarihi değiştirilebilir. Eski alanlar sunucuya önizleme olarak gönderilir; başka işlemde değiştirilmiş giderin üzerine yazılmaz. Kasa ve aylık rapor güncel değerlerden hesaplanır.
- **Giderler → Belgeler:** Kaydedilmiş gidere JPG/PNG/WEBP/PDF dosyası eklenebilir (dosya başına 10 MB, gider başına 5 belge). Finansal kaydı kaydetme ile dosya yükleme ayrı işlemlerdir; başarısız yüklemeyi tekrar denemek ikinci gider oluşturmaz. Tamamlanamayan kayıtlar yönetici tarafından kaldırılabilir.
- Belgeler varsayılan olarak yalnızca yöneticiye açıktır. Yönetici belge bazında **Ortak ekranda göster** seçebilir; ortak gösterim ayrıca onaylanır. Gizlenen dosyalar için yeni bağlantı üretilemez; önceden üretilmiş bağlantı en fazla 60 saniye geçerlidir. Özel dosya adları ortak özette bulunmaz.
- Dosyalar ayrı ve özel `apartman-expense-files` Storage bucket'ında tutulur. Her nesne kayıtlı dosya yoluyla eşleştirilir. Yükleme/silme yalnızca apartman yöneticisine açıktır; diğer Acısu yöneticileri bu yetkiyi kazanmaz. Upsert/üzerine yazma kapalıdır. Mevcut Acısu bucket ve politikaları değiştirilmez.
- Bir gideri silmeden önce belgeleri kaldırmak gerekir. Dosya kaldırma Storage API ile yapılır; gerçek dosya kaldırılmadan metadata kaydı silinemez. JSON kayıt yedeği belge listesini içerir, dosya içeriğini içermez; dosyalar ayrıca indirilmelidir.

- **Diğer → Eski borç girişi:** Yönetici daireyi, borcun ait olduğu önceki tarihini, kalan tutarı ve özel açıklamasını girer. Aynı bölüm/ay için ikinci borç açılmaz; muaf bölümün eski borcu kaydedilebilir. Devir kaydı kasayı değiştirmez, tahsilat yapıldığında kasa artar. Her eski ay ayrı kaydedilir; zaten girilmiş borcu yeniden devretmeyin.
- **Aidatlar → Ayrıntılar:** Daire hesabı; borçlandırma, ödeme ve hareket sonrası bakiye tarih sırasıyla gösterilir. Eski bir borca buradan ödeme alınabilir. Kopyalanan/indirilen döküm özel yönetici notlarını veya malik/oturan isimlerini içermez.
- **Özet → Aylık hesap özeti:** Devreden kasa + ödeme tarihine göre o ayki tahsilat − o ayki gider = ay sonu kasa. Eski aya ait aidat bu ay ödenirse bu ayın tahsilatında sayılır. Ay sonu alacağı o aya kadar oluşan borçlar ve o aya kadar girilen ödemelerle hesaplanır; raporlar güncel kayıtlardan üretilir, kilitli muhasebe kapanışı değildir. Kayıtlı açılış kasa tutarı sistemin başlangıç bakiyesidir.
- Aylık özet herkes tarafından görülebilir, metin olarak kopyalanabilir/indirilebilir. Otomatik WhatsApp gönderimi yapılmaz; kullanıcı kopyalanan metni kendisi paylaşır.

- Ana menü: Özet, Aidatlar, Giderler, Diğer. Duyurular ile yöneticiye özel daire/ayar ekranları Diğer altında toplanır.
- Özet ekranında kasa tüm dönemleri; toplanan ve kalan aidat kartları seçili aya ait tahakkukları gösterir. Ödeme bekleyenler listesi tüm dönemlerin borcunu kapsar.
- Aidatlar telefona uygun daire kartlarıyla gösterilir. Önceki aylardan borçlar ayrı belirtilir; Ayrıntılar üzerinden eski bir aya ödeme girilebilir.
- Ödeme al ekranında kalan tutar ve bugünün tarihi hazır gelir. Tarih ve not isteğe bağlı açılır.
- Düzenle/sil seçenekleri kartın işlem menüsünde, seçim kutuları ise Toplu işlem modu açıldığında görünür. Ödemeli aidatları koruyan kurallar değişmez.

- Ortak takip ekranında aidatlar, giderler, kasa ve duyurular görüntülenir.
- Yönetici girişi Supabase Auth e-posta/şifre ile yapılır. Kayıt olma akışı yoktur.
- Apartman yetkisi `apartman_admins` tablosundan kontrol edilir. Acısu yöneticisi olmak tek başına apartman yetkisi vermez.
- İlk kurulumda 8 daire + 1 dükkân tanımlıdır; bölüm adları düzenlenebilir.
- Aylık aidat tek işlemle muaf olmayan bölümlere oluşturulur. Aynı bölüm ve ay ikinci kez borçlandırılmaz.
- Bölümler → Düzenle / Muafiyet → **Aidattan muaf tut** yalnızca yeni borçlandırmalara uygulanır; eski borç ve ödemeler korunur.
- Aidatlar ekranında kutucuklardan ödeme girilmemiş kayıtları seçip **Toplu düzenle** ile ay/tutar değiştirilebilir; **Toplu sil** ile kaldırılabilir. Her satırda tekil Düzenle / Sil seçenekleri de vardır. Silmede etkilenen toplam gösterilir ve SİL yazılması istenir.
- Ödeme girilmiş aidatların seçimi ve düzenleme/silme işlemi kapalıdır. Yanlış bir ödeme onayı varsa önce ilgili ödeme kaydı iptal edilmelidir; gerçek tahsilatlar sırf aidatı düzenlemek için iptal edilmemelidir. Eski kayıtlar işlem geçmişinde saklanır.
- Tam/kısmi ödeme onayı, ödeme iptali, yönetim gideri dahil ortak giderler, duyurular, CSV ve JSON yedeği vardır.
- Özet ekranındaki kasa tüm dönemleri; aylık aidat/gider listeleri seçili ayı kapsar.
- Açılış kasa bakiyesi negatif olamaz. Aidat değişikliği geçmiş tahakkukları yeniden hesaplamaz.

## Veriler ve yetkiler

Tablolar: `apartman_expense_files`, `apartman_admins`, `apartman_units`, `apartman_charges`, `apartman_payments`, `apartman_expenses`, `apartman_notices`, `apartman_settings`, `apartman_audit`.

Bu tabloların tamamında RLS açıktır; `anon` ve `authenticated` için doğrudan tablo/sequence erişimi kapalıdır. Bu nedenle güvenlik danışmanındaki **RLS Enabled No Policy** bilgi notları bu tasarımda bilinçlidir; herkese açık tablo politikası eklemeyin.

API, public şemasındaki SECURITY INVOKER RPC fonksiyonlarından geçer:

- `apartman_state()` ortak özeti; yetkili yönetici için ayrıca özel alanları döndürür.
- `apartman_action(action,payload)` yalnızca apartman yöneticilerine işlem yaptırır.
- `apartman_manage_charges(payload)` mevcut aidatları ödeme ve eşzamanlılık kontrolleriyle yönetir.
- `apartman_opening_charge(payload)` yalnızca apartman yöneticisine eski borç girişi yaptırır.
- `apartman_expense_manage(payload)` gider düzenleme, belge rezervasyonu/onayı, görünürlük ve metadata kaldırmayı yönetici yetkisiyle yapar.

Ayrıcalıklı uygulama kodu Data API'ye açılmayan `apartman_private` şemasındadır. Yönetim işlemlerinde üyelik `auth.uid()` üzerinden kontrol edilir. Ortak ekranda malik/oturan isimleri, özel borç/ödeme notları ve yönetici işlem geçmişi yoktur. Hesap dökümü için ödeme tarihi, tutarı ve bağlı aidat kimliği ortak özette bulunur. Ortak ekran bağlantıyı bilen herkese açık olduğundan bölüm etiketleri ve ödeme durumları görülebilir.

Tutarlar kuruş cinsinden tamsayıdır. Ödeme kontrolleri ve aylık borçlandırmalar bir veritabanı işlemi içinde kilitlemeyle yapılır; eşzamanlı istekler fazla ödeme veya çift aidat oluşturamaz. Oturum aynı sekmenin `sessionStorage` alanında apartmana özgü anahtarla tutulur; şifre kaydedilmez. Çıkış Supabase'in yalnızca mevcut oturumunu kapatır.

`public/config.js` yalnızca herkese açık publishable key içerir; `service_role` anahtarı asla istemciye eklenmez. Acısu'nun tabloları, politikaları, kullanıcıları veya Auth ayarları bu kurulumda değiştirilmez. Projenin Auth ve kullanım limitleri ortak kalır.

## Yayın

GitHub Settings → Pages → Source: **GitHub Actions**. `.github/workflows/check.yml` kontroller geçtikten sonra yalnızca `public/` dizinini Pages'e gönderir. Kaynak kodundaki dosya yolları alt dizin yayınına uygundur. Özel alan adı gerekmez.

Yerel önizleme:

```sh
npm start
```

Python 3 ile http://localhost:3000 açılır. Üretim yayını herhangi bir Python/Node sunucusu çalıştırmaz.

## Veritabanı kurulumu ve doğrulama

`supabase/schema.sql` ilk kuruluma ait eklemeli şemadır; kurulu projede tekrar çalıştırmayın. Kurulum Supabase migration geçmişine kaydedilmiştir. Fonksiyon değişikliklerini yeni bir migration olarak uygulayın. `supabase/charge-management.sql` aidat düzenleme/silme yükseltmesidir; `supabase/verify-charge-management.sql` ilgili işlemleri ROLLBACK ile test eder.

`supabase/account-statements.sql` eski borç ve hesap dökümü yükseltmesidir; `supabase/verify-account-statements.sql` borç, kasa ve yetki kontrollerini ROLLBACK ile doğrular.

`supabase/expense-receipts.sql` gider/belge yükseltmesinin tam SQL kaydıdır. Uygulanan yükseltme küçük adımlar halinde migration geçmişine kaydedilmiştir; kurulu projede tekrar çalıştırmayın. `supabase/verify-expense-receipts.sql` gider, kasa, dosya kuralları ve yetkileri ROLLBACK ile doğrular; testte gerçek dosya yüklenmez.

`supabase/verify.sql` bütün finansal test işlemlerini **ROLLBACK** ile geri alır. Test için Auth hesabı açmaz ve gerçek finansal kayıt bırakmaz. Yönetici kimliği yalnızca `apartman_admins` tablosundan seçilir; yetkisiz kullanıcı için sabit bir test kimliği kullanılır.

```sh
npm run check
npm test
```

JavaScript testleri oturum yenileme, ayrı yönetici kontrolü, RPC eşlemesi ve hata yönetimini kontrol eder. Canlı veritabanındaki doğrulama; muafiyet, mükerrer aidat, fazla/kısmi ödeme, gider, kasa, ödeme iptali, anonim erişim ve apartman yöneticisi olmayan kimliğin yetkisizliğini kapsar.

## Yedek ve önceki sürüm

Yönetim → JSON yedeği indir ile kayıtlar dışa aktarılabilir. Dosya malik/oturan isimlerini içerir; güvenli yerde saklayın. Otomatik yedekleme ve JSON içe aktarma bu sürümde yoktur. Supabase ücretsiz plandaysa hareketsizlikte duraklatma ve proje genelindeki ücretsiz limitler uygulanır.

Önceki Sites uygulamasının gerçek kayıtları otomatik taşınmamıştır. SQLite sunucusu Git geçmişinde korunur; güncel sürüm Supabase kullanır.

## Kararlar ve işler

Diğer → Kararlar / Yapılacak işler üzerinden tüm kullanıcılar kayıtları görebilir. Yönetici; karar tarihi, numarası, metni ve imzalı sayfanın fotoğraf/PDF kopyasını ekleyebilir. İşlere sorumlu, hedef tarih, durum ve ilgili karar atanır. Ana ekran açık işleri hedef tarihine göre gösterir; gecikenler işaretlenir. Tamamlanan işler ayrıca filtrelenir. Kayıtlar arşivlenip geri alınabilir. Eşzamanlı düzenlemeler sürüm kontrolüyle korunur.

Karar belgeleri mevcut özel belge deposunu kullanır; önce yalnızca yönetici görür, ortak ekranda gösterme ayrıca seçilir. Dijital belge fiziksel imzalı kararın kopyasıdır. JSON yedeğine karar ve iş kayıtları ile belge metadata listesi dahildir; dosya içerikleri dahil değildir. `supabase/decisions-tasks.sql` eklemeli yükseltmedir; `verify-decisions-tasks.sql` kayıt, durum, arşiv, sürüm, kasa ve yetkileri ROLLBACK ile doğrular.

## Ödeme hesabı ve hatırlatma

Yönetim → Aidat ödeme hesabı alanına Türkiye IBAN ve hesap sahibi girilir. Biçim ve mod-97 kontrolü hem tarayıcıda hem sunucuda yapılır; bu kontrol hesabın varlığını veya sahibini doğrulamaz. Hesap bilgileri ortak Aidatlar ekranında görünür, IBAN boşaltılarak kaldırılır. Ayrı banka ayarı işlemi, aidat ve kasa ayarlarını değiştirmez; eşzamanlı değişiklikler beklenen eski değerlerle korunur.

Yönetici Aidatlar → Hatırlatma hazırla ile daireye ait tüm kalan borçları içeren metni görüp düzenleyebilir ve kopyalayabilir. Tam ödenmiş dönemler atlanır; kısmi ödemeler düşülür. WhatsApp'a gönderme kullanıcı tarafından yapılır. Malik/oturan isimleri ve özel notlar metne alınmaz. `supabase/payment-tools.sql` yükseltmeyi, `verify-payment-tools.sql` ROLLBACK doğrulamasını içerir.

## Ödeme makbuzları

Ödeme kaydedilince makbuz önizlemesi açılır. Aidatlar → Ödeme kayıtları → Makbuz ve daire hesap dökümündeki ödeme satırından eski makbuzlar da açılır. Numara ödeme kimliğinden kalıcı olarak `KM-000001` biçiminde üretilir; yeniden açmak yeni ödeme oluşturmaz. Tutar yalnızca o tahsilata aittir, ödeme tarihi ile aidat dönemi ayrı gösterilir. Malik/oturan ve özel notlar belgeye alınmaz.

Makbuz PNG olarak indirilir; bağlantıdaki sayfa üzerinden yazdırma/PDF kaydetme de kullanılabilir. İndirilmiş görüntü sonradan değişmez. Güncel durum belgedeki bağlantıdan kontrol edilir: sayfa ve yeni indirmeler mevcut ödeme kaydını sorgular; silinmiş/iptal edilmiş veya bulunamayan kayıt için makbuz gösterilmez. Bu ekranlar mevcut ortak ödeme verisini kullanır. Hiçbir tahsilat/silme işlemi makbuz görüntüleme nedeniyle tetiklenmez.

## Aylık bilanço

Özet ekranındaki Aylık bilanço düğmesi, seçilen ayın devreden kasasını, tahsilatını, harcamasını, gelir-gider farkını, ay sonu kasasını ve kalan alacağını tek raporda açar. Tahsilat satırları gerçek ödeme tarihine, harcamalar gider tarihine göredir. Kategori özeti ve harcama açıklamaları dahildir. Borçlu dairelerde o ayın kalan aidatı ile önceki dönem borcu ayrılır; kısmi ödeme, ödemedi ve yalnızca önceki dönem borcu durumları belirtilir. Sonraki aylarda yapılan ödemeler geçmiş ay sonundaki borcu kapatmış göstermez. Tamamı ödenen daireler borç listesine alınmaz.

Metni kopyala / Metin indir seçenekleri tüm raporu içerir. Yazdır / PDF kaydet seçeneği rapora uygun sayfa düzenini kullanır. Borçlar ve bakiyeler mevcut kayıtlardan hesaplanır; rapor oluşturmak finansal kayıt değiştirmez. Malik/oturan ve özel ödeme notları rapora eklenmez.

## İşlem geçmişi ve geri alma

Yönetici Diğer → İşlem geçmişi üzerinden bu yükseltmeden sonra yapılan son 100 ödeme/gider işlemini, işlemi yapan yönetici ve İstanbul saatini görebilir. Yönetim → Kayıtlar ve yedek alanında da kısayol vardır. Ödeme ekleme ve iptal etme; gider ekleme, düzenleme ve silme geri alınabilir. Onay ekranı kasa ve aidat borcundaki değişimi gösterir. Diğer işlemler audit listesinde görünür, geri alma kapsamı dışındadır; eski kayıtlara geriye dönük snapshot üretilmez.

Sunucu mevcut kayıt ile işlem sonrasındaki snapshotı karşılaştırır; aynı kayıt sonradan değişmişse önce en son değişiklik geri alınmalıdır. Ödeme geri yüklenirken aidatın hâlâ var olması ve tutarın kalan borcu aşmaması kontrol edilir. Belge eklenmiş giderin oluşturulmasını geri almak için önce belgeleri kaldırmak gerekir. Geri alınmış işlem ikinci kez çalıştırılamaz; telafi kaydı ayrıca saklanır. Ödeme geri yüklenince özgün kimliği/makbuz numarası korunur. Kasa ve borçlar mevcut kayıtlardan yeniden hesaplanır.

`apartman_changes` RLS ile kapalıdır; history/undo RPC yalnızca apartman yöneticilerine açıktır. Yönetici etiketi oturumun email claiminden, yoksa kullanıcı kimliğinin ilk 8 karakterinden oluşur. Başka uygulamanın kullanıcıları veya tabloları okunmaz. JSON yedeğine tüm journal kayıtları dahil edilir. `supabase/financial-undo.sql` migration kaydıdır; `verify-financial-undo.sql` ödeme/gider yaşam döngüsü, stale/duplicate koruması, belge bağımlılığı, kasa/borç ve yetkileri ROLLBACK ile test eder.

## Aidat araması ve filtreler

Aidatlar ekranında daire/dükkân adına göre arama ile Hepsi, Borcu olanlar, Kısmi ödeyenler ve Ödeyenler filtreleri birlikte çalışır. Borcu olanlar seçili ay ve önceki aylardan kalan borcu içerir; sonraki ayların aidatları filtreye dahil edilmez. Kısmi ödeme seçili aya göredir. Ödeyenler seçili ay aidatını tamamlayan ve önceki borcu kalmayan bölümlerdir; muaf veya aidat oluşturulmamış bölümler ödeme yapmış sayılmaz. Üstteki aylık toplamlar tüm bölümlere aittir; filtre sonucu ayrıca sayılır. Arama yalnızca bölüm adı kullanır, malik/oturan bilgisi kullanmaz.

Arama/filtre değişiminde toplu seçim temizlenir. Görünenleri seç yalnızca filtrede görünen, seçili ayda hiç ödeme girilmemiş aidatları kapsar. Arama yazılırken imleç korunur; Temizle varsayılan listeyi geri getirir. Finansal veri yazımı veya veritabanı değişikliği yapılmaz.

## Ana ekrana ekleme

Ana sayfadaki Telefona ekle düğmesi desteklenen tarayıcıda kullanıcının onayıyla yükleme penceresini açar. Pencere sunulmuyorsa cihazın tarayıcı menüsü için adımlar gösterilir: Android Chrome'da Uygulamayı yükle/Ana ekrana ekle; iPhone Safari'de Paylaş → Ana Ekrana Ekle. Cihazına yükleme onayını kullanıcı verir; uzaktan otomatik yükleme yapılmaz. Açılış adı Komşu, simgesi mevcut K markasıdır. Uygulama olarak açıldığında yükleme kartı gizlenir.

`manifest.webmanifest` ve ikonlar GitHub Pages alt dizinine göre bağıl yolludur. Service worker yalnızca kendi alt dizinini kapsar. Yalnızca offline.html ve offline.css önbelleğe alınır; uygulama kodu, oturum, API, banka/ödeme/gider kayıtları ve dosyalar Service Worker cache'ine alınmaz. Finansal çağrılar ve yazmalar yakalanmaz, kuyruklanmaz. İnternetsiz yeni açılışta statik bağlantı ekranı gösterilir; açık sayfada bağlantı kesilirse güncellik uyarısı görünür. Normal açılışlar ağdan alınarak güncelleme kilitlenmesi önlenir. Eski cache temizliği yalnızca bu uygulamanın kendi cache adıyla sınırlıdır.

Yerel doğrulama: 51 Node testi; yükleme olayları/standalone durumu, bağlantı uyarısı, SW ağ stratejisi, başka uygulama cache'lerine dokunmama ve finansal istekleri yakalamama testleri dahildir. İkon boyutları ayrıca doğrulanır. Kaynaklar: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable ve https://support.apple.com/en-lamr/guide/iphone/iphea86e5236/ios .

## Sade özet düzeni

Özette güncel kasa, tüm dönemlerden kalan aidat, seçilen ayın ödeme tarihine göre tahsilatı ve önceki aylardan güncel kalan borç dört kısa kartta görünür. Aidat ilerlemesi kompakt tutulur; ayrıntılı gider dağılımı ve tablolar aylık bilançoda yer alır. En yüksek borçlu üç bölüm gösterilir, Tümü penceresi tüm dönemlerde borcu kalan bölümlere erişim verir. Haberlerde her dolu gruptan son bir duyuru, karar ve görev bulunur; boş gruplar gizlenir. Açık işler en fazla üç satırla gösterilir; tüm kayıtlar kendi ekranlarından açılabilir.

Diğer menüsü Bilgiler ve yalnızca yöneticiye görünen Yönetici işlemleri olarak düzenlenir. Telefona ekle hem Diğer menüsünden hem ana içeriğin altındaki karttan kullanılabilir. Başlık, kartlar ve boşluklar küçültülerek özellikle telefonda daha az kaydırma hedeflenir. Finansal kayıtlar ve yetkiler değişmez.

## Toplam borçtan ödeme alma

Yönetici Aidatlar → dairenin **Ödeme al** düğmesinden tek tutar girer. Kayıtlı tüm dönemlerin kalan borcu en eski aydan başlayarak kapatılır; tutar yetmezse son ay kısmi ödenir. Kaydetmeden önce ay bazında dağılım ve ödeme sonrası kalan toplam gösterilir. Daire hesabındaki **Toplam borçtan ödeme al** aynı ekranı açar; belirli bir aya ödeme girme seçenekleri ayrıca korunur. Gelecek dönem için önceden oluşturulmuş borç da kayıtlı toplamın içindedir; henüz oluşturulmamış aidata avans yazılmaz. Borcu aşan tutar kabul edilmez.

Sunucu tutarı kuruş olarak hesaplar ve dağılımı tek transaction içinde kaydeder. Önizlemeden sonra borç/ödeme değişmişse eski bakiye üzerinden kayıt yapılmaz. Aynı açık formun bağlantı hatası sonrası tekrar gönderimi sabit request UUID ile ilk sonucu döndürür; ikinci tahsilat oluşturmaz. Form kapatılıp yeniden açıldığında yeni işlem başlar; belirsiz bağlantı hatasında tekrar ödeme açmadan önce kayıtlar yenilenip kontrol edilmelidir.

Sonuç ekranında her aya ait makbuz ve **Tüm ödemeyi geri al** bulunur. İşlem geçmişinden de grubun tamamı veya tek ödeme geri alınabilir. Toplu geri alma tüm aylarda birlikte başarılı olur; bir satırın geri alınması mümkün değilse hiçbir satır değiştirilmez. Sonradan iptal edilmiş satırlar sonuç ekranında belirtilir.

`apartman_payment_batches` ve `apartman_payment_batch_items` doğrudan erişime kapalıdır. Yeni ödeme/grup bilgisi/grup geri alma RPC'leri yalnızca apartman yöneticisine açıktır. JSON yedeğinde `paymentBatches` ve `paymentBatchItems` bulunur. `supabase/oldest-first-payments.sql` uygulanmış migration kaydıdır; adımları tekrar çalıştırmayın.

Doğrulama: 58 Node testi ve sözdizimi kontrolleri geçti. `verify-oldest-first-payments.sql` eski aydan dağılım, kısmi ödeme, kuruş hassasiyeti, aynı istek tekrarı, stale/taşan tutar koruması, grup geçmişi/yedeği, atomik geri alma ve yetkileri sentetik kayıtlarla ROLLBACK içinde test eder. Mevcut finans ve işlem geri alma SQL kontrolleri de geçti. Yönetici formu DOM taklidiyle test edildi; gerçek yönetici oturumunda ödeme oluşturulmadı.
