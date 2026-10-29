// Lobby-tilstandsmaskinen: utfordring → ja/nei → kven er vert.
//
// Ingen nettverk her — js/lobby.js tek meldingane som reine objekt, so vi kan
// spele to «spelarar» mot kvarandre i same prosess og sjå at dei kjem fram til
// same kamp-id og motsette vertsroller (det er heile poenget: ingen ekstra
// rundtur for å avtale kven som styrer).
//
// Køyr:  node tests/lobby.test.js
const path = require('path');

global.window = global;
global.navigator = { userAgent: 'node' };
require(path.join(__dirname, '..', 'js', 'lobby.js'));

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' :: ' + JSON.stringify(x) : '')); } };

// Ein «spelar»: eigen LOBBY-instans er ikkje mogleg (modulen er singelton), so
// vi lagar to like verdener ved å byggje meldingsflyten sjølv.
function makePeer(myId, id) {
  const out = { sent: [], started: null, invited: null, outcome: null };
  LOBBY.init({
    send: (o) => out.sent.push(o),
    onStart: (gameId, isHost, other) => { out.started = { gameId, isHost, other }; },
    onInvite: (inv) => { out.invited = inv; },
    onOutcome: (kind, from) => { out.outcome = { kind, from }; },
    render: () => {},
  });
  LOBBY.setIdentity(myId);
  LOBBY.setPeers([myId, 'zzz-other']);
  LOBBY.reset();
  return out;
}

// ---------- 1. utfordre, få ja, same kamp-id, motsette vertsroller ----------
(function () {
  const A = 'aaa-challenger', B = 'bbb-target';

  // A utfordrar
  const a = makePeer(A);
  const id = LOBBY.challenge(B);
  ok('utfordringa fekk ein id', typeof id === 'string' && id.length > 3, id);
  ok('utfordringa vart sendt med rett mottakar',
     a.sent.length === 1 && a.sent[0].t === 'chal' && a.sent[0].to === B, a.sent);

  // B mottek ho
  const b = makePeer(B);
  LOBBY.onMsg(a.sent[0]);
  ok('B fekk invitasjonen', b.invited && b.invited.from === A, b.invited);

  // B seier ja
  LOBBY.accept();
  ok('B sende ja', b.sent.some(m => m.t === 'chal-yes' && m.id === id), b.sent);
  ok('B starta partiet som gjest', b.started && b.started.isHost === false, b.started);

  // A mottek ja — men A sin LOBBY er no B sin (singelton), so vi spelar A-sida
  // ved å setje identiteten attende og sende svaret inn på nytt.
  const a2 = makePeer(A);
  LOBBY.challenge(B);                         // ny utfordring frå A
  const id2 = LOBBY.state.pending.id;
  LOBBY.onMsg({ t: 'chal-yes', id: id2, from: B });
  ok('A starta partiet som vert (lågast id)', a2.started && a2.started.isHost === true, a2.started);
  ok('båe sidene fekk same kamp-id', a2.started && a2.started.gameId === id2, a2.started);
})();

// ---------- 2. vertsregelen er symmetrisk ---------------------------------
ok('lågast id er vert (A<B)', LOBBY.hostFor('aaa', 'bbb') === 'aaa');
ok('lågast id er vert (B>A)', LOBBY.hostFor('bbb', 'aaa') === 'aaa');
ok('lik id gjev same svar', LOBBY.hostFor('x', 'x') === 'x');

// ---------- 3. avslag ------------------------------------------------------
(function () {
  const a = makePeer('aaa');
  const id = LOBBY.challenge('bbb');
  LOBBY.onMsg({ t: 'chal-no', id, from: 'bbb' });
  ok('avslag nullstiller utfordringa', LOBBY.state.pending === null, LOBBY.state.pending);
  ok('avslaget vart rapportert', a.outcome && a.outcome.kind === 'no', a.outcome);
})();

// ---------- 4. oppteken ----------------------------------------------------
(function () {
  makePeer('aaa');
  const id = LOBBY.challenge('bbb');
  LOBBY.onMsg({ t: 'chal-busy', id, from: 'bbb' });
  ok('«oppteken» nullstiller utfordringa', LOBBY.state.pending === null);
})();

// ---------- 5. utfordring til nokon andre vert oversedt -------------------
(function () {
  const a = makePeer('aaa');
  LOBBY.onMsg({ t: 'chal', id: 'x1', from: 'ccc', to: 'ddd' });
  ok('utfordring til andre rører ikkje meg', a.invited === null && LOBBY.state.incoming === null);
})();

// ---------- 6. berre éi utfordring om gongen ------------------------------
(function () {
  makePeer('aaa');
  const first = LOBBY.challenge('bbb');
  const second = LOBBY.challenge('ccc');
  ok('den andre utfordringa vert avvist lokalt', first !== null && second === null, { first, second });
})();

// ---------- 7. medan ein spelar, svarar ein «oppteken» --------------------
(function () {
  const a = makePeer('aaa');
  const id = LOBBY.challenge('bbb');
  LOBBY.onMsg({ t: 'chal-yes', id, from: 'bbb' });
  ok('partiet er i gang', !!LOBBY.state.gameId);
  LOBBY.onMsg({ t: 'chal', id: 'new', from: 'ccc', to: 'aaa' });
  ok('ei ny utfordring midt i eit parti får «oppteken»',
     a.sent.some(m => m.t === 'chal-busy'), a.sent);
})();

console.log('lobby: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
