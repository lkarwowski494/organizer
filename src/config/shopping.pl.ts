/**
 * Działy listy zakupów (D85, ADR 0018). Lista i kolejność to konwencja aplikacji (od świeżych produktów, przez
 * spiżarnię, do chemii), a nie twierdzenie o układzie konkretnych sklepów — każdą pozycję można przenieść ręcznie,
 * a grupa zapamiętuje wybór. Klucze muszą być równe private.shopping_categories() w SQL (test kontraktowy).
 *
 * Słownik (heurystyka do podpowiedzi działu, poprawiana ręcznie): nazwa pozycji po zdjęciu ilości, małymi literami.
 *  1. Wpisy wielowyrazowe („papier toaletowy”, „mleko modyfikowane”) — najdłuższy pasujący fragment wygrywa.
 *  2. Potem słowo po słowie od lewej: wpis z „*” to początek słowa (odmiana: „jabłk*” → jabłko, jabłka; „jabłek” ma
 *     inny rdzeń, więc osobny wpis), wpis bez „*” musi pasować całe słowo (krótkie rdzenie: „ser” ≠ „serwetki”).
 *     Gdy pasuje kilka wpisów, wygrywa najdłuższy („żelk*” przed „żel*”).
 *  Nierozpoznane → „Inne”. Każdy wpis występuje w słowniku raz (test).
 *
 * Poprawki ze źródłem (audyt 2, M-230): „masło orzechowe” to nie nabiał — „Masło orzechowe – wyrób spożywczy wytwarzany
 * z nasion orzachy podziemnej (tzw. orzeszków ziemnych)” (https://pl.wikipedia.org/wiki/Masło_orzechowe); „Peanut butter
 * is the food prepared by grinding one of the shelled and roasted peanut ingredients” (21 CFR 164.150(a),
 * https://www.law.cornell.edu/cfr/text/21/164.150). Dział „Spiżarnia” jak inne pasty do pieczywa w słowniku (dżem, miód,
 * nutella) — konwencja słownika, nie twierdzenie o układzie sklepu. Tofu i napoje roślinne („mleko owsiane”) — otwarte
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
    'morel*', 'kiwi', 'ananas*', 'arbuz*', 'melon*', 'awokado', 'mango', 'granat*',
    'pomidor*', 'ogór*', 'ogórk*', 'ziemniak*', 'ziemniaków', 'kartof*', 'marchew', 'marchewk*', 'marchwi', 'cebul*', 'czosn*',
    'papryk*', 'sałat*', 'rukol*', 'szpinak*', 'kapust*', 'brokuł*', 'kalafior*', 'cukini*', 'cukinia', 'bakłażan*', 'dyni*',
    'dynia', 'por', 'pora', 'pory', 'seler*', 'pietruszk*', 'pietruszek', 'koper', 'koperek', 'koperku', 'szczypior*', 'rzodkiew*',
    'rzodkiewk*', 'buraczk*', 'buraki', 'burak', 'buraków', 'fasolk*', 'groszek', 'kukurydz*', 'pieczark*', 'grzyb*', 'imbir*',
    'natk*', 'kiełk*', 'warzyw*', 'owoc*', 'zieleni*', 'bazyli*', 'mięt*', 'kalarep*', 'szparag*', 'jarmuż*', 'botwink*',
  ],
  bakery: [
    'chleb*', 'chlebek', 'bułk*', 'bułek', 'bułeczk*', 'bagietk*', 'rogal*', 'rogalik*', 'croissant*', 'pieczyw*', 'grahamk*',
    'kajzerk*', 'chałk*', 'drożdżówk*', 'pączk*', 'pączek', 'tortill*', 'pita', 'chlebki', 'sucharki', 'tost*',
  ],
  dairy: [
    'mleko', 'mleka', 'mlek*', 'jogurt*', 'kefir*', 'maślank*', 'śmietan*', 'śmietank*', 'masło', 'masła', 'masełk*', 'margaryn*',
    'ser', 'sera', 'sery', 'serek', 'serki', 'serków', 'twaróg', 'twarogu', 'twarożek', 'mozzarell*', 'parmezan*', 'feta', 'fety',
    'jaja', 'jajka', 'jajek', 'jajko', 'jaj', 'skyr*', 'budyń', 'serniczek', 'mascarpone', 'ricotta', 'gouda', 'edam*', 'brie',
    'camembert*', 'halloumi',
  ],
  meat: [
    'mięs*', 'kurczak*', 'kurczaka', 'kurcz*', 'pierś', 'piersi', 'filet*', 'udk*', 'skrzydeł*', 'skrzydełk*', 'indyk*', 'wołowin*',
    'wieprzow*', 'schab*', 'karkówk*', 'boczek', 'boczku', 'żeberk*', 'mielon*', 'kiełbas*', 'kiełbask*', 'parówk*', 'parówek',
    'szynk*', 'polędwic*', 'salami', 'kabanos*', 'pasztet*', 'wędlin*', 'baleron*', 'ryb*', 'łosoś', 'łososia', 'łosos*', 'dorsz*',
    'mintaj*', 'pstrąg*', 'tuńczyk*', 'śledź', 'śledzie', 'śledzi*', 'makrel*', 'krewetk*', 'kaczk*', 'gulasz*', 'golonk*',
    'kotlet*', 'salceson*', 'kaszank*',
  ],
  frozen: ['mrożon*', 'lody', 'lodów', 'pierogi', 'pierogów', 'pyzy', 'kopytka', 'frytki', 'frytek', 'pizza', 'pizzę', 'pizze', 'kostki lodu', 'paluszki rybne'],
  pantry: [
    'makaron*', 'spaghetti', 'penne', 'ryż', 'ryżu', 'kasz*', 'mąk*', 'cukier', 'cukru', 'sól', 'soli', 'pieprz*', 'przypraw*',
    'olej*', 'oliw*', 'ocet', 'octu', 'musztard*', 'ketchup*', 'majonez*', 'sos*', 'koncentrat*', 'passat*', 'pomidory w puszce',
    'konserw*', 'puszk*', 'fasola', 'fasoli', 'ciecierzyc*', 'soczewic*', 'groch', 'płatki', 'płatków', 'musli', 'müsli', 'granol*',
    'owsiank*', 'kawa', 'kawy', 'kawę', 'herbat*', 'kakao', 'miód', 'miodu', 'dżem*', 'konfitur*', 'nutell*', 'drożdże',
    'proszek do pieczenia', 'bułka tarta', 'kisiel*', 'galaretk*', 'rosół', 'kostk*', 'bulion*', 'zupk*', 'zup*', 'orzech*',
    'migdał*', 'rodzynk*', 'słonecznik*', 'pestk*', 'siemię', 'oliwk*', 'ogórki konserwowe', 'korniszon*', 'ketchupu', 'chrzan*',
    'curry', 'papryka słodka', 'cynamon*', 'wanili*', 'żelatyn*', 'skrobi*', 'kukurydza w puszce', 'tuńczyk w puszce', 'hummus*',
    'masło orzechow*', 'masła orzechow*',
  ],
  sweets: [
    'czekolad*', 'cukierk*', 'cukierków', 'baton*', 'ciastk*', 'ciastek', 'ciasto', 'ciasta', 'herbatnik*', 'wafl*', 'wafelk*',
    'żelk*', 'żelek', 'chips*', 'chipsy', 'paluszk*', 'krakers*', 'popcorn*', 'słodycz*', 'lizak*', 'gum*', 'pierniki', 'piernik*',
    'delicj*', 'biszkopt*', 'chrupk*', 'prażynk*', 'orzeszki',
  ],
  drinks: [
    'woda', 'wody', 'wodę', 'wód', 'sok', 'soki', 'soku', 'soków', 'napój', 'napoje', 'napoju', 'cola', 'coli', 'colę', 'pepsi',
    'sprite', 'fanta', 'oranżad*', 'lemoniad*', 'piwo', 'piwa', 'wino', 'wina', 'wódk*', 'syrop*', 'izoton*', 'energetyk*',
    'kompot*', 'nektar*', 'tonik*', 'cydr*', 'prosecco', 'szampan*',
  ],
  baby: [
    'pieluch*', 'pieluszk*', 'pampers*', 'chusteczki nawilżane', 'kaszka', 'kaszki', 'kaszkę', 'słoiczk*', 'mleko modyfikowane',
    'smoczek', 'smoczki', 'butelka dla dziecka', 'nawilżane',
  ],
  household: [
    'papier', 'papieru', 'ręcznik*', 'ręczniki papierowe', 'worki', 'worków', 'woreczk*', 'folia', 'folii', 'folię', 'płyn*',
    'proszek', 'proszku', 'kapsułk*', 'tabletk*', 'zmywark*', 'domestos*', 'cif', 'ludwik*', 'gąbk*', 'gąbek', 'ściereczk*',
    'ścierk*', 'zapałki', 'świeczk*', 'świec*', 'baterie', 'baterii', 'żarówk*', 'odplamiacz*', 'wybielacz*', 'odkamieniacz*',
    'mop*', 'miotł*', 'serwetk*', 'serwetek', 'zmiękczacz*', 'płukank*', 'odświeżacz*', 'środek*',
    'rękawiczk*', 'aluminiow*', 'pergamin*', 'sól do zmywarki', 'nabłyszczacz*', 'worki na śmieci',
  ],
  hygiene: [
    'szampon*', 'odżywk*', 'mydł*', 'mydełk*', 'żel*', 'pasta do zębów', 'szczoteczk*', 'nić dentystyczn*', 'dezodorant*',
    'antyperspirant*', 'krem*', 'balsam*', 'podpaski', 'podpasek', 'tampon*', 'wkładki', 'patyczki', 'waciki', 'wacików',
    'maszynk*', 'pianka do golenia', 'golenia', 'kosmetyk*', 'płyn do płukania ust', 'perfum*', 'plastr*', 'tabletki na',
    'witamin*', 'leki', 'lek', 'apap', 'ibuprom', 'chusteczki', 'chusteczki higieniczne', 'papier toaletowy', 'toaletow*', 'higieniczn*',
  ],
  pets: ['karm*', 'żwirek', 'żwirku', 'dla psa', 'dla kota', 'psa', 'kota', 'kotów', 'psów', 'whiskas', 'pedigree', 'felix', 'przysmak* dla'],
};
