// A compact, hand-authored list of common English words, most frequent first. Plover's
// dictionary carries no frequency data, so this is used as a weight in word selection: common
// words come up more often than obscure ones that merely happen to be short. Pure data/function,
// so it runs in the page and in tests, same pattern as steno.js and lessons.js.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.StenoWordFreq = factory();
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  // Rank 0 = most frequent. Not exhaustive; words outside this list fall back to a floor weight.
  const RANKED_WORDS = (
    'the be to of and a in that have i it for not on with he as you do at this but his by from ' +
    'they we say her she or an will my one all would there their what so up out if about who get ' +
    'which go me when make can like time no just him know take people into year your good some ' +
    'could them see other than then now look only come its over think also back after use two how ' +
    'our work first well way even new want because any these give day most us is was are been has ' +
    'had were said did having may am might must shall should need let got made went came saw found ' +
    'told asked felt put read run show called tried turned left moved lived believed brought began ' +
    'kept held sat stood heard spoke wrote stood ' +
    'man woman child world school state family student group country problem hand part place case ' +
    'week company system program question work number night point home water room mother area money ' +
    'story fact month lot right study book eye job word business issue side kind head house service ' +
    'friend father power hour game line end member law car city community name team minute idea body ' +
    'information back parent face others level office door health person art war history party result ' +
    'change morning reason research girl guy moment air teacher force education foot boy age policy ' +
    'process music market sense nation plan college interest death experience effect use class ' +
    'control care field development role effort rate heart drug show leader light voice wife police ' +
    'mind price report decision son hope view relationship town road arm paper space form rule reason ' +
    'event cost speech ' +
    'new good high old great big small large next early young important few public bad same able low ' +
    'late little own other right last long different hard open real white black red blue green full ' +
    'local main sure best better worse clear dark light heavy strong weak fast slow close far near ' +
    'short tall wide narrow deep shallow rich poor simple complex clean dirty quiet loud warm cold ' +
    'hot cool fresh ready busy free easy difficult possible likely certain true false recent current ' +
    'national international political economic social personal professional financial natural ' +
    'physical mental legal human general specific particular common special normal usual typical ' +
    'this that these those what which who whom whose where when why how all any some no each every ' +
    'other another such own same ' +
    'i you he she it we they me him her us them my your his its our their mine yours hers ours ' +
    'theirs myself yourself himself herself itself ourselves yourselves themselves ' +
    'is am are was were be been being have has had do does did will would shall should may might ' +
    'must can could ' +
    'not no yes very too also just only even still already yet again once twice always never often ' +
    'sometimes usually rarely ever soon now then here there today tomorrow yesterday ' +
    'up down in out on off over under again further then once here there when where why how all ' +
    'both each few more most other some such no nor not only own same so than too very ' +
    'one two three four five six seven eight nine ten hundred thousand million first second third ' +
    'eat drink sleep walk run jump sit stand talk speak listen hear see watch look read write draw ' +
    'paint sing dance play work study learn teach help build make create design plan start begin end ' +
    'finish stop continue try attempt succeed fail win lose buy sell pay spend save earn cost own ' +
    'have hold keep give take bring carry send receive accept reject choose decide agree disagree ' +
    'ask answer tell explain describe discuss argue suggest recommend advise warn promise refuse ' +
    'allow forbid require need want wish hope expect believe know understand remember forget imagine ' +
    'consider realize notice recognize discover find lose search seek check test try use apply fix ' +
    'repair break destroy damage improve develop grow increase decrease reduce raise lower change ' +
    'move turn push pull lift drop throw catch hold release open close lock unlock enter exit arrive ' +
    'leave return stay remain live die born grow age marry divorce meet greet welcome invite visit ' +
    'call phone email text message write reply respond react feel touch smell taste hear see ' +
    'computer internet phone email website app software hardware data file folder screen keyboard ' +
    'mouse button click type print scan upload download search browse connect network server client ' +
    'account password login logout settings update install remove delete copy paste cut save open ' +
    'close window tab link page site app code program bug fix test debug build deploy release version ' +
    'dog cat bird fish horse cow pig sheep chicken mouse rabbit lion tiger bear wolf fox deer elephant ' +
    'monkey snake frog tree flower grass leaf root branch forest field garden farm mountain river lake ' +
    'ocean sea sky sun moon star cloud rain snow wind storm weather season spring summer fall winter ' +
    'north south east west city town village street road bridge building house apartment room kitchen ' +
    'bathroom bedroom living dining garage yard floor wall ceiling window door roof stairs ' +
    'food water bread rice meat fish chicken beef pork egg milk cheese butter sugar salt pepper fruit ' +
    'apple orange banana grape lemon vegetable potato tomato onion carrot coffee tea juice wine beer ' +
    'breakfast lunch dinner meal restaurant kitchen cook bake fry boil grill recipe taste flavor sweet ' +
    'sour bitter salty spicy ' +
    'red orange yellow green blue purple pink brown black white gray gold silver ' +
    'happy sad angry afraid surprised excited bored tired hungry thirsty sick healthy strong weak ' +
    'brave shy proud ashamed jealous grateful curious confused worried relieved calm nervous confident'
  )
    .split(/\s+/)
    .filter(Boolean)
    .reduce((unique, word) => (unique.includes(word) ? unique : (unique.push(word), unique)), []);

  const rankOf = new Map(RANKED_WORDS.map((word, index) => [word, index]));

  // Weight for one word, highest for the most frequent. Words not on the list still get a
  // modest floor weight, so uncommon-but-valid steno words keep a chance of coming up. Decays
  // (roughly Zipf-like) from 1 at rank 0 down to the floor across the whole ranked list, rather
  // than collapsing to the floor after only the first few dozen words.
  const FLOOR_WEIGHT = 0.15;

  function freqWeight(word) {
    const rank = rankOf.get(String(word).toLowerCase());
    if (rank === undefined) return FLOOR_WEIGHT;
    const span = 1 - FLOOR_WEIGHT;
    return 1 - span * (rank / RANKED_WORDS.length);
  }

  return { RANKED_WORDS, freqWeight };
});
