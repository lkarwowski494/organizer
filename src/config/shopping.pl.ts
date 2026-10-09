/**
 * Działy listy zakupów (D85, ADR 0018). Lista i kolejność to konwencja aplikacji (od świeżych produktów, przez
 * spiżarnię, do chemii), a nie twierdzenie o układzie konkretnych sklepów — każdą pozycję można przenieść ręcznie,
 * a grupa zapamiętuje wybór. Klucze muszą być równe private.shopping_categories() w SQL (test kontraktowy).
 *
 * Słownik (heurystyka do podpowiedzi działu, poprawiana ręcznie): nazwa pozycji po zdjęciu ilości, małymi literami.
 *  1. Wpisy wielowyrazowe („papier toaletowy”, „mleko modyfikowane”) — najdłuższy pasujący fragment wygrywa.
 *  2. Określenie z SHOPPING_QUALIFIERS w dowolnym miejscu nazwy („szpinak mrożony”, „woda micelarna”).
 *  3. Potem słowo po słowie od lewej: wpis z „*” to początek słowa (odmiana: „jabłk*” → jabłko, jabłka; „jabłek” ma
 *     inny rdzeń, więc osobny wpis), wpis bez „*” musi pasować całe słowo (krótkie rdzenie: „ser” ≠ „serwetki”).
 *     Gdy pasuje kilka wpisów, wygrywa najdłuższy („żelk*” przed „żel*”, „nektarynk*” przed „nektar*”).
 *  Nierozpoznane → „Inne”. Każdy wpis występuje w słowniku raz (test). Korpus typowych nazw z oczekiwanym działem
 *  (src/domain/__tests__/fixtures/shopping-departments.pl.txt, oczekiwania spisane niezależnie od kodu) — test regresji.
 *  Nazw marek w słowniku nie ma (decyzja właściciela z 9.10.2026) — tylko ogólne nazwy produktów.
 *
 * Poprawki ze źródłem (audyt 2, M-230): „masło orzechowe” to nie nabiał — „Masło orzechowe – wyrób spożywczy wytwarzany
 * z nasion orzachy podziemnej (tzw. orzeszków ziemnych)” (https://pl.wikipedia.org/wiki/Masło_orzechowe); „Peanut butter
 * is the food prepared by grinding one of the shelled and roasted peanut ingredients” (21 CFR 164.150(a),
 * https://www.law.cornell.edu/cfr/text/21/164.150). Dział „Spiżarnia” jak inne pasty do pieczywa w słowniku (dżem, miód,
 * krem czekoladowy) — konwencja słownika, nie twierdzenie o układzie sklepu. Tofu i napoje roślinne („mleko owsiane”) — otwarte
 * pytanie (O-059: brak przeczytanego źródła o dziale w polskich sklepach).
 */
export const SHOPPING_CATEGORIES = [
  { key: 'produce', name: 'Owoce i warzywa' },
  { key: 'bakery', name: 'Pieczywo' },
  { key: 'dairy', name: 'Nabiał i jaja' },
  { key: 'meat', name: 'Mięso, wędliny i ryby' },
  { key: 'frozen', name: 'Mrożonki' },
  { key: 'pantry', name: 'Spiżarnia' },
  { key: 'sweets', name: 'Słodycze i przekąski' },
  { key: 'drinks', name: 'Napoje' },
  { key: 'baby', name: 'Dla dziecka' },
  { key: 'household', name: 'Chemia i dom' },
  { key: 'hygiene', name: 'Higiena i kosmetyki' },
  { key: 'pets', name: 'Dla zwierząt' },
  { key: 'other', name: 'Inne' },
] as const;

export type ShoppingCategory = (typeof SHOPPING_CATEGORIES)[number]['key'];

export const SHOPPING_KEYWORDS: { readonly [K in Exclude<ShoppingCategory, 'other'>]: readonly string[] } = {
  produce: [
    'jabłk*', 'jabłek', 'gruszk*', 'gruszek', 'banan*', 'pomarańcz*', 'mandaryn*', 'cytryn*', 'limonk*', 'grejpfrut*',
    'winogron*', 'truskaw*', 'malin*', 'borówk*', 'borówek', 'jagod*', 'wiśni*', 'czereśni*', 'śliwk*', 'śliwek', 'brzoskwi*',
    'morel*', 'kiwi', 'ananas*', 'arbuz*', 'melon*', 'awokado', 'mango', 'granat*', 'nektarynk*', 'figi', 'figa', 'fig',
    'pomidor*', 'ogór*', 'ogórk*', 'ziemniak*', 'ziemniaków', 'kartof*', 'marchew', 'marchewk*', 'marchwi', 'cebul*', 'czosn*',
    'papryk*', 'sałat*', 'rukol*', 'szpinak*', 'kapust*', 'brokuł*', 'kalafior*', 'cukini*', 'cukinia', 'bakłażan*', 'dyni*',
    'dynia', 'por', 'pora', 'pory', 'seler*', 'pietruszk*', 'pietruszek', 'koper', 'koperek', 'koperku', 'szczypior*', 'rzodkiew*',
    'rzodkiewk*', 'buraczk*', 'buraki', 'burak', 'buraków', 'fasolk*', 'groszek', 'kukurydz*', 'pieczark*', 'grzyb*', 'imbir*',
    'natk*', 'kiełk*', 'warzyw*', 'owoc*', 'zieleni*', 'bazyli*', 'mięt*', 'kalarep*', 'szparag*', 'jarmuż*', 'botwink*',
  ],
  bakery: [
    'chleb*', 'chlebek', 'bułk*', 'bułek', 'bułeczk*', 'bagietk*', 'rogal*', 'rogalik*', 'croissant*', 'pieczyw*', 'grahamk*',
    'kajzerk*', 'chałk*', 'drożdżówk*', 'pączk*', 'pączek', 'tortill*', 'pita', 'chlebki', 'sucharki', 'tost*', 'jagodziank*',
  ],
  dairy: [
    'mleko', 'mleka', 'mlek*', 'jogurt*', 'kefir*', 'maślank*', 'śmietan*', 'śmietank*', 'masło', 'masła', 'masełk*', 'margaryn*',
    'ser', 'sera', 'sery', 'serek', 'serki', 'serków', 'twaróg', 'twarogu', 'twarożek', 'mozzarell*', 'parmezan*', 'feta', 'fety',
    'jaja', 'jajka', 'jajek', 'jajko', 'jaj', 'skyr*', 'budyń', 'serniczek', 'mascarpone', 'ricotta', 'gouda', 'edam*', 'brie',
    'camembert*', 'halloumi', 'kostk* masła', 'plastr* ser*',
  ],
  meat: [
    'mięs*', 'kurczak*', 'kurczaka', 'kurcz*', 'pierś', 'piersi', 'filet*', 'udk*', 'skrzydeł*', 'skrzydełk*', 'indyk*', 'wołowin*',
    'wieprzow*', 'schab*', 'karkówk*', 'boczek', 'boczku', 'żeberk*', 'mielon*', 'kiełbas*', 'kiełbask*', 'parówk*', 'parówek',
    'szynk*', 'polędwic*', 'salami', 'kabanos*', 'pasztet*', 'wędlin*', 'baleron*', 'ryb*', 'łosoś', 'łososia', 'łosos*', 'dorsz*',
    'mintaj*', 'pstrąg*', 'tuńczyk*', 'śledź', 'śledzie', 'śledzi*', 'makrel*', 'krewetk*', 'kaczk*', 'gulasz*', 'golonk*',
    'kotlet*', 'salceson*', 'kaszank*', 'plastr* szynk*', 'plastr* wędlin*',
  ],
  frozen: ['mrożon*', 'lody', 'lodów', 'pierogi', 'pierogów', 'pyzy', 'kopytka', 'frytki', 'frytek', 'pizza', 'pizzę', 'pizze', 'kostki lodu', 'paluszki rybne'],
  pantry: [
    'makaron*', 'spaghetti', 'penne', 'ryż', 'ryżu', 'kasz*', 'mąk*', 'cukier', 'cukru', 'sól', 'soli', 'pieprz*', 'przypraw*',
    'olej*', 'oliw*', 'ocet', 'octu', 'musztard*', 'ketchup*', 'majonez*', 'sos*', 'koncentrat*', 'passat*', 'pomidory w puszce',
    'konserw*', 'puszk*', 'fasola', 'fasoli', 'ciecierzyc*', 'soczewic*', 'groch', 'płatki', 'płatków', 'musli', 'müsli', 'granol*',
    'owsiank*', 'kawa', 'kawy', 'kawę', 'herbat*', 'kakao', 'miód', 'miodu', 'dżem*', 'konfitur*', 'krem czekoladow*', 'drożdże',
    'proszek do pieczenia', 'bułka tarta', 'kisiel*', 'galaretk*', 'rosół', 'kostk*', 'bulion*', 'zupk*', 'zup*', 'orzech*',
    'migdał*', 'rodzynk*', 'słonecznik*', 'pestk*', 'siemię', 'oliwk*', 'ogórki konserwowe', 'korniszon*', 'ketchupu', 'chrzan*',
    'curry', 'papryka słodka', 'cynamon*', 'wanili*', 'żelatyn*', 'skrobi*', 'kukurydza w puszce', 'tuńczyk w puszce', 'hummus*',
    'masło orzechow*', 'masła orzechow*', 'daktyl*', 'sezam*', 'kwasek', 'kwasku', 'kwask*', 'pomidor* krojon*',
  ],
  sweets: [
    'czekolad*', 'cukierk*', 'cukierków', 'baton*', 'ciastk*', 'ciastek', 'ciasto', 'ciasta', 'herbatnik*', 'wafl*', 'wafelk*',
    'żelk*', 'żelek', 'chips*', 'chipsy', 'paluszk*', 'krakers*', 'popcorn*', 'słodycz*', 'lizak*', 'gum*', 'pierniki', 'piernik*',
    'biszkopt*', 'chrupk*', 'prażynk*', 'orzeszki', 'karmel*', 'miętówk*', 'kremówk*', 'przysmak* dla dzieci',
  ],
  drinks: [
    'woda', 'wody', 'wodę', 'wód', 'sok', 'soki', 'soku', 'soków', 'napój', 'napoje', 'napoju', 'cola', 'coli', 'colę',
    'oranżad*', 'lemoniad*', 'piwo', 'piwa', 'wino', 'wina', 'wódk*', 'syrop*', 'izoton*', 'energetyk*',
    'kompot*', 'nektar*', 'tonik*', 'cydr*', 'prosecco', 'szampan*',
  ],
  baby: [
    'pieluch*', 'pieluszk*', 'chusteczki nawilżane', 'kaszka', 'kaszki', 'kaszkę', 'słoiczk*', 'mleko modyfikowane',
    'smoczek', 'smoczki', 'butelka dla dziecka', 'nawilżane', 'oliwk* dla dzieci',
  ],
  household: [
    'papier', 'papieru', 'ręcznik*', 'ręczniki papierowe', 'worki', 'worków', 'woreczk*', 'folia', 'folii', 'folię', 'płyn*',
    'proszek', 'proszku', 'kapsułk*', 'tabletk*', 'zmywark*', 'mleczko do czyszczenia', 'gąbk*', 'gąbek', 'ściereczk*',
    'ścierk*', 'zapałki', 'świeczk*', 'świec*', 'baterie', 'baterii', 'żarówk*', 'odplamiacz*', 'wybielacz*', 'odkamieniacz*',
    'mop*', 'miotł*', 'serwetk*', 'serwetek', 'zmiękczacz*', 'płukank*', 'odświeżacz*', 'środek*',
    'rękawiczk*', 'aluminiow*', 'pergamin*', 'sól do zmywarki', 'nabłyszczacz*', 'worki na śmieci', 'do prania', 'do wc',
  ],
  hygiene: [
    'szampon*', 'odżywk*', 'mydł*', 'mydełk*', 'żel*', 'pasta do zębów', 'szczoteczk*', 'nić dentystyczn*', 'dezodorant*',
    'antyperspirant*', 'krem*', 'balsam*', 'podpaski', 'podpasek', 'tampon*', 'wkładki', 'patyczki', 'waciki', 'wacików',
    'maszynk*', 'pianka do golenia', 'golenia', 'kosmetyk*', 'płyn do płukania ust', 'perfum*', 'plastr*', 'tabletki na',
    'witamin*', 'leki', 'lek', 'paracetamol*', 'ibuprofen*', 'chusteczki', 'chusteczki higieniczne', 'papier toaletowy', 'toaletow*', 'higieniczn*',
    'micelarn*', 'utlenion*', 'płatki kosmetyczn*', 'syrop* na', 'olejek', 'olejk*', 'do kąpieli', 'do włosów',
  ],
  pets: ['karm*', 'żwirek', 'żwirku', 'dla psa', 'dla kota', 'psa', 'kota', 'kotów', 'psów', 'przysmak* dla'],
};

/**
 * Określenia, które wygrywają z pierwszym słowem nazwy (audyt 3, N-168): „szpinak mrożony” to mrożonka, „kukurydza
 * konserwowa” — spiżarnia, „woda micelarna” i „woda utleniona” — higiena. Sprawdzane po wpisach wielowyrazowych, przed
 * regułą „słowo po słowie od lewej”; składnia jak w słowniku. Konwencja słownika, jak działy.
 */
export const SHOPPING_QUALIFIERS: { readonly [K in Exclude<ShoppingCategory, 'other'>]?: readonly string[] } = {
  frozen: ['mrożon*'],
  pantry: ['konserwow*'],
  hygiene: ['micelarn*', 'utlenion*'],
};

/**
 * Formy jednego produktu (audyt 3, N-48): „2 mleka”, „10 jajek”, „1 kg pomidorów” to ten sam produkt co „mleko”,
 * „jajka”, „pomidory” — przy stałych zakupach, podpowiedziach i pamięci działu. Każda grupa to formy jednego hasła;
 * pierwsza forma to klucz porównań (nigdzie niepokazywany). Formy z Wikisłownika (szablon odmiany w haśle, np.
 * https://pl.wiktionary.org/wiki/jajko: „mianownik | jajko | jajka”, „dopełniacz | jajka | jajek”; pobrane 9.10.2026):
 * mianownik i dopełniacz obu liczb oraz biernik liczby pojedynczej — formy, które stoją po liczbie i jednostce
 * („2 jajka”, „10 jajek”, „1 kg mąki”) i w zapisie „kupić wodę”. Produkty spoza listy porównujemy dosłownie.
 */
export const SHOPPING_FORMS: readonly (readonly string[])[] = [
  ['mleko', 'mleka'], ['jajko', 'jajka', 'jajek'], ['masło', 'masła'], ['ser', 'sera', 'sery', 'serów'],
  ['serek', 'serka', 'serki', 'serków'], ['jogurt', 'jogurtu', 'jogurty', 'jogurtów'], ['kefir', 'kefiru'],
  ['śmietana', 'śmietany', 'śmietanę'], ['twaróg', 'twarogu', 'twarogi', 'twarogów'],
  ['chleb', 'chleba', 'chleby', 'chlebów'], ['bułka', 'bułki', 'bułkę', 'bułek'],
  ['rogal', 'rogala', 'rogale', 'rogali', 'rogalów'], ['rogalik', 'rogalika', 'rogaliki', 'rogalików'],
  ['bagietka', 'bagietki', 'bagietkę', 'bagietek'], ['drożdżówka', 'drożdżówki', 'drożdżówkę', 'drożdżówek'],
  ['pączek', 'pączka', 'pączki', 'pączków'], ['kajzerka', 'kajzerki', 'kajzerkę', 'kajzerek'],
  ['jabłko', 'jabłka', 'jabłek'], ['gruszka', 'gruszki', 'gruszkę', 'gruszek'],
  ['banan', 'banana', 'banany', 'bananów'], ['pomarańcza', 'pomarańczy', 'pomarańczę', 'pomarańcze', 'pomarańcz'],
  ['mandarynka', 'mandarynki', 'mandarynkę', 'mandarynek'], ['cytryna', 'cytryny', 'cytrynę', 'cytryn'],
  ['limonka', 'limonki', 'limonkę', 'limonek'], ['śliwka', 'śliwki', 'śliwkę', 'śliwek'],
  ['brzoskwinia', 'brzoskwini', 'brzoskwinię', 'brzoskwinie', 'brzoskwiń'],
  ['truskawka', 'truskawki', 'truskawkę', 'truskawek'], ['malina', 'maliny', 'malinę', 'malin'],
  ['borówka', 'borówki', 'borówkę', 'borówek'], ['arbuz', 'arbuza', 'arbuzy', 'arbuzów'],
  ['melon', 'melona', 'melony', 'melonów'], ['ananas', 'ananasa', 'ananasy', 'ananasów'],
  ['pomidor', 'pomidora', 'pomidory', 'pomidorów'], ['ogórek', 'ogórka', 'ogórki', 'ogórków'],
  ['ziemniak', 'ziemniaka', 'ziemniaki', 'ziemniaków'], ['marchewka', 'marchewki', 'marchewkę', 'marchewek'],
  ['cebula', 'cebuli', 'cebulę', 'cebule', 'cebul'], ['papryka', 'papryki', 'paprykę', 'papryk'],
  ['kapusta', 'kapusty', 'kapustę', 'kapust'], ['brokuł', 'brokułu', 'brokuła', 'brokuły', 'brokułów'],
  ['kalafior', 'kalafiora', 'kalafiory', 'kalafiorów'], ['cukinia', 'cukinii', 'cukinię', 'cukinie'],
  ['bakłażan', 'bakłażana', 'bakłażanu', 'bakłażany', 'bakłażanów'],
  ['pieczarka', 'pieczarki', 'pieczarkę', 'pieczarek'], ['rzodkiewka', 'rzodkiewki', 'rzodkiewkę', 'rzodkiewek'],
  ['burak', 'buraka', 'buraki', 'buraków'], ['por', 'pora', 'pory', 'porów'], ['seler', 'selera', 'selery', 'selerów'],
  ['kurczak', 'kurczaka', 'kurczaki', 'kurczaków'], ['parówka', 'parówki', 'parówkę', 'parówek'],
  ['kiełbasa', 'kiełbasy', 'kiełbasę', 'kiełbas'], ['kiełbaska', 'kiełbaski', 'kiełbaskę', 'kiełbasek'],
  ['szynka', 'szynki', 'szynkę', 'szynek'], ['kotlet', 'kotleta', 'kotlety', 'kotletów'],
  ['filet', 'filetu', 'filety', 'filetów'], ['udko', 'udka', 'udek'], ['skrzydełko', 'skrzydełka', 'skrzydełek'],
  ['pierś', 'piersi'], ['ryba', 'ryby', 'rybę', 'ryb'], ['śledź', 'śledzia', 'śledzie', 'śledzi'],
  ['makrela', 'makreli', 'makrelę', 'makrele', 'makrel'], ['krewetka', 'krewetki', 'krewetkę', 'krewetek'],
  ['kabanos', 'kabanosa', 'kabanosy', 'kabanosów'], ['pasztet', 'pasztetu', 'pasztety', 'pasztetów'],
  ['kasza', 'kaszy', 'kaszę', 'kasze', 'kasz'], ['makaron', 'makaronu', 'makarony', 'makaronów'], ['ryż', 'ryżu'],
  ['mąka', 'mąki', 'mąkę', 'mąk'], ['cukier', 'cukru', 'cukry', 'cukrów'], ['kawa', 'kawy', 'kawę', 'kaw'],
  ['herbata', 'herbaty', 'herbatę', 'herbat'], ['sok', 'soku', 'soki', 'soków'], ['woda', 'wody', 'wodę', 'wód'],
  ['piwo', 'piwa', 'piw'], ['wino', 'wina', 'win'], ['napój', 'napoju', 'napoje', 'napoi', 'napojów'],
  ['cukierek', 'cukierka', 'cukierki', 'cukierków'], ['ciastko', 'ciastka', 'ciastek'],
  ['baton', 'batona', 'batony', 'batonów'], ['wafel', 'wafla', 'wafle', 'wafli'],
  ['wafelek', 'wafelka', 'wafelki', 'wafelków'], ['lizak', 'lizaka', 'lizaki', 'lizaków'],
  ['pielucha', 'pieluchy', 'pieluchę', 'pieluch'], ['pieluszka', 'pieluszki', 'pieluszkę', 'pieluszek'],
  ['chusteczka', 'chusteczki', 'chusteczkę', 'chusteczek'], ['worek', 'worka', 'worki', 'worków'],
  ['gąbka', 'gąbki', 'gąbkę', 'gąbek'], ['rękawiczka', 'rękawiczki', 'rękawiczkę', 'rękawiczek'],
  ['bateria', 'baterii', 'baterię', 'baterie'], ['żarówka', 'żarówki', 'żarówkę', 'żarówek'],
  ['świeczka', 'świeczki', 'świeczkę', 'świeczek'], ['serwetka', 'serwetki', 'serwetkę', 'serwetek'],
  ['kapsułka', 'kapsułki', 'kapsułkę', 'kapsułek'], ['tabletka', 'tabletki', 'tabletkę', 'tabletek'],
  ['szampon', 'szamponu', 'szampony', 'szamponów'], ['mydło', 'mydła', 'mydeł'],
  ['podpaska', 'podpaski', 'podpaskę', 'podpasek'], ['tampon', 'tamponu', 'tampony', 'tamponów'],
  ['płyn', 'płynu', 'płyny', 'płynów'], ['proszek', 'proszku', 'proszki', 'proszków'],
  ['karma', 'karmy', 'karmę', 'karm'], ['jajo', 'jaja', 'jaj'],
];
