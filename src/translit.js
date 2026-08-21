// Latinize a place name so it can be turned into a readable id.
//
// Ids are built by stripping everything outside a-z0-9, which leaves nothing at
// all for an Armenian or Russian name and mangles Latin ones that carry
// diacritics (Kraków -> "krak-w", Gdańsk -> "gda-sk"). Folding the text down to
// plain ASCII first means a name in any of the three languages the app accepts
// still produces something recognisable.

// Armenian. 'ու' is a digraph and has to be replaced before the single letters,
// or it comes out as "ov".
const HY = {
  ա: 'a', բ: 'b', գ: 'g', դ: 'd', ե: 'e', զ: 'z', է: 'e', ը: 'y', թ: 't',
  ժ: 'zh', ի: 'i', լ: 'l', խ: 'kh', ծ: 'ts', կ: 'k', հ: 'h', ձ: 'dz', ղ: 'gh',
  ճ: 'ch', մ: 'm', յ: 'y', ն: 'n', շ: 'sh', ո: 'o', չ: 'ch', պ: 'p', ջ: 'j',
  ռ: 'r', ս: 's', վ: 'v', տ: 't', ր: 'r', ց: 'ts', ւ: 'v', փ: 'p', ք: 'k',
  օ: 'o', ֆ: 'f', և: 'ev',
}

// Russian, plus the four Ukrainian letters that turn up in city names.
const RU = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
}
// 'е' maps to e everywhere rather than ye at the start of a word as BGN/PCGN
// would have it. These are ids, not romanisations: "erevan" reads fine, and the
// flat rule means the Armenian and Russian spellings of a city agree on one id.

const CYRILLIC_AND_ARMENIAN = { ...HY, ...RU }

// Latin letters that carry their stroke or ligature inside the code point, so
// the NFD pass below can't separate it off.
const LATIN = { ł: 'l', đ: 'd', ð: 'd', ø: 'o', ß: 'ss', æ: 'ae', œ: 'oe', þ: 'th', ħ: 'h', ı: 'i' }

export function latinize(name) {
  let s = String(name).toLowerCase().replace(/ու/g, 'u')
  // Cyrillic and Armenian first: NFD would split й into и + breve and ё into
  // е + diaeresis, and dropping those marks loses the y and the yo.
  s = s.replace(/[\u0400-\u04ff\u0530-\u058f]/g, (ch) =>
    ch in CYRILLIC_AND_ARMENIAN ? CYRILLIC_AND_ARMENIAN[ch] : ch)
  s = s.replace(/[łđðøßæœþħı]/g, (ch) => LATIN[ch])
  // Everything else with a diacritic decomposes, so the marks can just be dropped.
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}
