import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Calculator, formatNumber, formatTokens, valueOf, normalize, caretMax, locate,
} from '../js/calculator.js';

/** Drive the calculator with a compact script: "2+3*(4-1)=" */
function run(script) {
  const calc = new Calculator();
  for (const ch of script) {
    if (ch >= '0' && ch <= '9') calc.digit(ch);
    else if (ch === '.') calc.decimal();
    else if (ch === '+') calc.operator('add');
    else if (ch === '-') calc.operator('subtract');
    else if (ch === '*') calc.operator('multiply');
    else if (ch === '/') calc.operator('divide');
    else if (ch === '(') calc.openParen();
    else if (ch === ')') calc.closeParen();
    else if (ch === 'p') calc.paren();
    else if (ch === '~') calc.negate();
    else if (ch === '=') calc.equals();
    else if (ch === '%') calc.percent();
    else if (ch === '<') calc.backspace();
    else if (ch === 'c') calc.clearAll();
    else if (ch === '^') calc.operator('power');
    else if (ch === 'q') calc.square();
    else if (ch === 'r') calc.reciprocal();
    else if (ch === 'v') calc.call('sqrt');
    else if (ch === 'P') calc.constant('pi');
    else if (ch === 'L') calc.moveCaret(-1);
    else if (ch === 'R') calc.moveCaret(1);
    else if (ch === '[') calc.caretHome();
    else if (ch === ']') calc.caretEnd();
    else throw new Error(`unknown token ${ch}`);
  }
  return calc;
}

/** What the display shows. */
const shown = (script) => run(script).state().expression;
/** The live result under the expression, before pressing equals. */
const preview = (script) => run(script).state().preview;

/** Compare against the number, ignoring the display's thousands separators. */
const yields = (script, expected) =>
  assert.equal(
    shown(`${script}=`).replace(/,/g, ''),
    String(expected),
    `${script} should give ${expected}`
  );

test('operators no longer calculate as you type', () => {
  const calc = run('2+3');
  assert.equal(calc.state().expression, '2 + 3');
  assert.equal(calc.state().committed, null, 'nothing is committed until equals');

  const chained = run('2+3*4');
  assert.equal(chained.state().expression, '2 + 3 × 4', 'the whole expression stays visible');
});

test('order of operations', () => {
  yields('2+3*4', 14);           // not 20
  yields('2*3+4', 10);
  yields('100-10*2', 80);
  yields('20/4+3', 8);
  yields('2+10/5', 4);
  yields('1+2*3+4*5', 27);
});

test('division and subtraction stay left-associative', () => {
  yields('100/10/2', 5);
  yields('20-5-3', 12);
});

test('parentheses override precedence', () => {
  yields('(2+3)*4', 20);
  yields('2*(3+4)', 14);
  yields('(1+2)*(3+4)', 21);
  yields('100/(2+3)', 20);
});

test('parentheses nest', () => {
  yields('((2+3)*2)+1', 11);
  yields('2*(3+(4*(5-3)))', 22);
  assert.equal(run('((((1+1))))=').state().expression, '2');
});

test('unclosed parentheses are closed on evaluation', () => {
  yields('2*(3+4', 14);
  yields('((2+3', 5);
  assert.equal(run('2*(3+4=').state().committed, '2 × (3 + 4)', 'the closers show in the committed expression');
});

test('a trailing operator is dropped rather than blocking evaluation', () => {
  yields('12+', 12);
  yields('2*3+', 6);
  assert.equal(preview('12*'), 12);
});

test('a stray closing parenthesis is ignored', () => {
  assert.equal(shown('2+3)'), '2 + 3');
  assert.equal(shown(')))'), '');
  assert.equal(shown('()'), '(', 'an empty group cannot be closed');
});

test('unary minus', () => {
  yields('-5+8', 3);
  yields('3*-2', -6);
  yields('(-4)*2', -8);
  yields('10-(-3)', 13);
  assert.equal(shown('-5'), '−5', 'a leading minus renders tight against its number');
  assert.equal(shown('3*-2'), '3 × −2');
});

test('a leading plus, times or divide is ignored', () => {
  assert.equal(shown('+'), '');
  assert.equal(shown('*'), '');
  assert.equal(shown('/5'), '5');
});

test('pressing an operator twice replaces it', () => {
  assert.equal(shown('5+*'), '5 × ');
  assert.equal(shown('5+*/'), '5 ÷ ');
  yields('5+*3', 15);
  // Including two minuses: a repeated press reads as a correction, not as a
  // double negative. "10 − −3" is still typeable as 10-(-3).
  yields('10--3', 7);
});

test('a minus after x or / is kept as a sign', () => {
  assert.equal(shown('5*-'), '5 × −');
  yields('5*-3', -15);
  yields('12/-4', -3);
});

test('implicit multiplication is made explicit as you type', () => {
  assert.equal(shown('2('), '2 × (');
  assert.equal(shown('(2+3)4'), '(2 + 3) × 4');
  assert.equal(shown('(2)('), '(2) × (');
  yields('2(3+4', 14);
});

test('the parser also accepts juxtaposition directly', () => {
  // Belt and braces: a token list built without the UI's inserted × still works.
  const tokens = [
    { type: 'number', text: '2' },
    { type: 'open' },
    { type: 'number', text: '3' },
    { type: 'operator', op: 'add' },
    { type: 'number', text: '4' },
    { type: 'close' },
  ];
  assert.equal(valueOf(tokens), 14);
});

test('percent is relative to the left-hand side for + and -', () => {
  yields('200+10%', 220);
  yields('200-10%', 180);
  yields('80*50%', 40);
  yields('50%', 0.5);
  assert.equal(shown('200+10%'), '200 + 10%');
});

test('percent respects grouping', () => {
  yields('(200+200)*50%', 200);
  yields('100+(10+10)%', 120);
});

test('percent only applies where there is a value to apply it to', () => {
  assert.equal(shown('%'), '');
  assert.equal(shown('5+%'), '5 + ');
});

test('decimals', () => {
  yields('1.5+2.5', 4);
  yields('.1+.2', 0.3);
  assert.equal(shown('1..5'), '1.5');
  assert.equal(shown('.'), '0.');
});

test('float artifacts are cleaned up', () => {
  yields('4.2*3', 12.6);
  yields('1.1*3', 3.3);
  yields('0.1+0.7', 0.8);
});

test('exact large integers survive', () => {
  yields('987654321*123456', 121931851853376);
});

test('live preview updates while typing and hides when incomplete', () => {
  assert.equal(preview('2+3'), 5);
  assert.equal(preview('2+3*4'), 14);
  assert.equal(preview('2*(3+4'), 14, 'an open group previews as if closed');
  assert.equal(preview(''), null);
  assert.equal(preview('('), null);
  assert.equal(preview('5/0'), null, 'a preview that is not a finite number is withheld');
});

test('equals commits the expression alongside the result', () => {
  const calc = run('2+3*4=');
  assert.equal(calc.state().expression, '14');
  assert.equal(calc.state().committed, '2 + 3 × 4');
  assert.equal(calc.state().preview, null, 'no preview once committed');
});

test('a digit after a result starts a new expression', () => {
  const calc = run('2+3=');
  calc.digit('7');
  assert.equal(calc.state().expression, '7');
  assert.equal(calc.state().committed, null);
});

test('an operator after a result continues from it', () => {
  const calc = run('2+3=');
  calc.operator('multiply');
  calc.digit('4');
  assert.equal(calc.state().expression, '5 × 4');
  calc.equals();
  assert.equal(calc.state().expression, '20');
});

test('an opening parenthesis after a result starts fresh', () => {
  const calc = run('2+3=');
  calc.openParen();
  assert.equal(calc.state().expression, '(');
});

test('equals on an already-committed result does nothing', () => {
  const calc = run('2+3==');
  assert.equal(calc.state().expression, '5');
});

test('equals on an empty expression does nothing', () => {
  assert.equal(shown('='), '');
});

test('backspace removes one character or one token at a time', () => {
  assert.equal(shown('123<'), '12');
  assert.equal(shown('12+<'), '12');
  assert.equal(shown('12+3<<'), '12');
  assert.equal(shown('(2+3)<'), '(2 + 3');
  assert.equal(shown('2(<'), '2 × ', 'the inserted × is a token of its own');
  assert.equal(shown('123<<<'), '');
});

test('backspace after a result clears it rather than editing the digits', () => {
  const calc = run('2+3=<');
  assert.equal(calc.state().expression, '');
  assert.equal(calc.state().committed, null);
});

test('divide by zero errors and the next keypress recovers', () => {
  const calc = run('5/0=');
  assert.equal(calc.state().errored, true);
  calc.digit('7');
  assert.equal(calc.state().errored, false);
  assert.equal(calc.state().expression, '7');
});

test('clear resets everything', () => {
  const calc = run('2+3*(4c');
  assert.equal(calc.state().expression, '');
  assert.equal(calc.state().isEmpty, true);
});

test('open depth is reported for the UI', () => {
  assert.equal(run('((2').state().openDepth, 2);
  assert.equal(run('((2)').state().openDepth, 1);
  assert.equal(run('2+3').state().openDepth, 0);
});

test('digits per number are capped, but the expression can hold many numbers', () => {
  const calc = run('1234567890123456789');
  assert.equal(calc.state().expression.replace(/[^0-9]/g, '').length, 12);
  const long = run('1+1+1+1+1+1+1+1+1+1');
  assert.equal(long.equals().state().expression, '10');
});

test('normalize leaves a complete expression untouched', () => {
  const tokens = run('2+3').tokens;
  assert.deepEqual(normalize(tokens), tokens);
});

test('numbers are grouped for display', () => {
  assert.equal(formatNumber('1234567'), '1,234,567');
  assert.equal(formatNumber('-9876.5'), '-9,876.5');
  assert.equal(formatNumber('1.50'), '1.50', 'trailing zeros survive while typing');
  assert.equal(shown('1234567+1'), '1,234,567 + 1');
});

test('very large results fall back to exponential', () => {
  const calc = run('99999999999*99999999999=');
  assert.match(calc.state().expression, /e\d+$/);
});

test('formatTokens round-trips what was typed', () => {
  assert.equal(formatTokens(run('12+(3*4)-5%').tokens), '12 + (3 × 4) − 5%');
});

test('the single parenthesis key opens or closes as appropriate', () => {
  assert.equal(shown('p'), '(');
  assert.equal(shown('p2'), '(2');
  assert.equal(shown('p2p'), '(2)');
  assert.equal(shown('p2pp'), '(2) × (', 'with nothing left to close it opens again');
  assert.equal(shown('p2+p3pp'), '(2 + (3))');
  assert.equal(shown('2+p'), '2 + (');
  assert.equal(shown('p2+p'), '(2 + (', 'it cannot close a group mid-operator');
  yields('p2+3p*4', 20);
});

test('sign toggling works inside an expression', () => {
  assert.equal(shown('5~'), '−5');
  assert.equal(shown('5~~'), '5');
  assert.equal(shown('12+5~'), '12 + −5');
  assert.equal(shown('12+5~~'), '12 + 5');
  assert.equal(shown('12-5~'), '12 − −5');
  yields('12+5~', 7);
  yields('12-5~', 17);
  yields('5~*3', -15);
});

test('sign toggling only applies to a number', () => {
  assert.equal(shown('~'), '');
  assert.equal(shown('5+~'), '5 + ');
  assert.equal(shown('p2p~'), '(2)', 'a closed group is left alone');
});

test('sign toggling a result negates it', () => {
  const calc = run('2+3=');
  calc.negate();
  assert.equal(calc.state().expression, '−5');
  assert.equal(calc.equals().state().expression, '-5');
});

test('a committed calculation keeps its own tokens for the history', () => {
  const calc = run('2+3*4=');
  assert.equal(calc.state().committed, '2 + 3 × 4');
  assert.equal(formatTokens(calc.state().committedTokens), '2 + 3 × 4',
    'the expression tokens survive even though `tokens` now holds the result');
  assert.equal(calc.state().expression, '14');
});

test('committed tokens include the parentheses that were closed for you', () => {
  const calc = run('2*(3+4=');
  assert.equal(formatTokens(calc.state().committedTokens), '2 × (3 + 4)');
});

test('committed tokens clear when a new expression starts', () => {
  const calc = run('2+3=');
  calc.digit('9');
  assert.equal(calc.state().committedTokens, null);
});

test('insertValue drops a history result into the expression', () => {
  const calc = new Calculator();
  calc.insertValue(42);
  assert.equal(calc.state().expression, '42');
  calc.operator('add');
  calc.insertValue(8);
  assert.equal(calc.state().expression, '42 + 8');
  assert.equal(calc.equals().state().expression, '50');
});

test('insertValue after a closed group multiplies', () => {
  const calc = run('p2+3p');
  calc.insertValue(4);
  assert.equal(calc.state().expression, '(2 + 3) × 4');
});

test('insertValue replaces a result rather than appending to it', () => {
  const calc = run('2+3=');
  calc.insertValue(9);
  assert.equal(calc.state().expression, '9');
});

test('loadTokens replaces the expression so it can be edited and re-run', () => {
  const source = run('2+3*4=');
  const calc = new Calculator();
  calc.loadTokens(source.state().committedTokens);
  assert.equal(calc.state().expression, '2 + 3 × 4');
  assert.equal(calc.state().preview, 14, 'and previews straight away');
  assert.equal(calc.state().committed, null, 'as something still being typed');

  calc.backspace();
  calc.digit('5');
  assert.equal(calc.equals().state().expression, '17', '2 + 3 × 5');
});

test('loadTokens copies, so editing cannot reach back into the history', () => {
  const source = run('2+3=');
  const stored = source.state().committedTokens;
  const calc = new Calculator();
  calc.loadTokens(stored);
  calc.digit('9');
  assert.equal(formatTokens(stored), '2 + 3', 'the original tokens are untouched');
});

test('loadTokens discards whatever was being typed', () => {
  const calc = run('99+1');
  calc.loadTokens(run('7*7=').state().committedTokens);
  assert.equal(calc.state().expression, '7 × 7');
});

test('loadTokens clears an error state', () => {
  const calc = run('5/0=');
  assert.equal(calc.state().errored, true);
  calc.loadTokens(run('1+1=').state().committedTokens);
  assert.equal(calc.state().errored, false);
  assert.equal(calc.state().expression, '1 + 1');
});

/* ------------------------------------------------------------- functions */

test('powers bind tighter than multiplication', () => {
  yields('2*3^2', 18);
  yields('2^3*2', 16);
});

test('powers are right-associative, the way they are written on paper', () => {
  yields('2^3^2', 512);
});

test('a leading minus applies to the power, not the base', () => {
  yields('-2^2', -4);
  yields('(-2)^2', 4);
});

test('an exponent can be signed', () => {
  yields('2^-2', 0.25);
});

test('a caret sits tight against its operands', () => {
  assert.equal(shown('2^10'), '2^10');
  assert.equal(shown('2+3^2'), '2 + 3^2', 'while + keeps its spacing');
});

test('a power with nothing after it previews as the base alone', () => {
  assert.equal(preview('7^'), 7);
});

test('squaring and reciprocal act on the value just entered', () => {
  yields('5q', 25);
  yields('5r', 0.2);
  assert.equal(shown('5q'), '5²');
  assert.equal(shown('5r'), '5⁻¹');
});

test('postfixes stack', () => {
  yields('5qr', 0.04);
});

test('a postfix applies to a bracketed group, not just a number', () => {
  yields('(2+3)q', 25);
});

test('a postfix needs something to act on', () => {
  assert.equal(shown('q'), '', 'nothing to square');
  assert.equal(shown('2+q'), '2 + ', 'and not an operator either');
});

test('a postfix carries on from a result', () => {
  const calc = run('2+3=');
  calc.square();
  assert.equal(calc.state().preview, 25);
});

test('square root opens its bracket ready for the argument', () => {
  assert.equal(shown('v'), '√(');
  assert.equal(preview('v9'), 3, 'and previews before it is closed');
  assert.equal(shown('v9p'), '√(9)');
});

test('a square root takes the value already entered', () => {
  assert.equal(shown('9v'), '√(9)', 'the way a calculator key does');
  assert.equal(shown('2+9v'), '2 + √(9)', 'and only that value, not the whole sum');
  assert.equal(preview('2+9v'), 5);
});

test('a square root takes a bracketed group whole', () => {
  assert.equal(shown('(2+7)v'), '√(2 + 7)', 'reusing the brackets it already has');
  assert.equal(preview('(2+7)v'), 3);
  assert.equal(shown('v9pv'), '√(√(9))', 'including one that is already a function');
});

test('a square root takes a value with its postfixes', () => {
  assert.equal(shown('5qv'), '√(5²)');
  assert.equal(preview('5qv'), 5);
});

test('a square root wraps a finished result rather than discarding it', () => {
  const calc = run('20+5=');
  calc.call('sqrt');
  assert.equal(calc.state().expression, '√(25)');
  assert.equal(calc.state().preview, 5);
});

test('backspace deletes a function and its bracket together', () => {
  assert.equal(shown('v<'), '', 'one press put both there, so one press removes them');
  assert.equal(shown('v9<'), '√(');
});

test('pi is a value like any other', () => {
  assert.equal(shown('P'), 'π');
  assert.equal(preview('P'), 3.14159265358979);
  yields('2*P', 6.28318530717959);
});

test('a value straight after a value multiplies, visibly', () => {
  assert.equal(shown('2P'), '2 × π');
  assert.equal(shown('P2'), 'π × 2');
  assert.equal(shown('5qP'), '5² × π');
});

test('an unfinished function is dropped rather than blocking the preview', () => {
  assert.equal(preview('2+v'), 2);
  assert.deepEqual(normalize([{ type: 'function', fn: 'sqrt' }, { type: 'open' }]), []);
});

test('the functions survive a round trip through the history', () => {
  const source = run('v9p^2q=');
  assert.equal(source.state().committed, '√(9)^2²');
  const calc = new Calculator();
  calc.loadTokens(source.state().committedTokens);
  assert.equal(calc.state().preview, 81);
});

test('unknown constants and functions are ignored rather than thrown', () => {
  const calc = new Calculator();
  calc.constant('tau');
  calc.call('log');
  assert.equal(calc.state().expression, '');
});

/* ---------------------------------------------------------------- the caret */

/** Where the caret ends up after a script. */
const caretOf = (script) => run(script).state().caret;

test('the caret starts and stays at the end while typing', () => {
  assert.equal(caretOf(''), 0);
  assert.equal(caretOf('123'), 3, 'one stop per digit');
  assert.equal(caretOf('12+3'), 4, 'and one for the operator');
  assert.equal(caretOf('12+3'), run('12+3').state().caretMax, 'which is the end');
});

test('a number offers one caret stop per character, everything else one', () => {
  assert.equal(caretMax(run('123').tokens), 3);
  assert.equal(caretMax(run('1+2').tokens), 3);
  assert.equal(caretMax(run('(1)').tokens), 3);
  assert.equal(caretMax(run('P').tokens), 1, 'a constant is one stop, not two');
  assert.equal(caretMax(run('5q').tokens), 2, 'and so is a postfix');
});

test('a result too long to have been typed is one indivisible stop', () => {
  // Exponential display cannot be matched up with the digits behind it, so it
  // offers no interior positions rather than ones that cannot be drawn.
  const calc = run('99999999999*99999999999=');
  assert.match(calc.state().expression, /e/, 'the result is exponential');
  assert.equal(calc.caretMax, 1);
});

test('the caret moves one stop at a time and stops at both ends', () => {
  assert.equal(caretOf('123L'), 2);
  assert.equal(caretOf('123LL'), 1);
  assert.equal(caretOf('123LLLL'), 0, 'and no further');
  assert.equal(caretOf('123LLR'), 2);
  assert.equal(caretOf('123LLRRRR'), 3, 'nor past the end');
  assert.equal(caretOf('12+3LL'), 2, 'an operator is a single step');
});

test('home and end jump to the ends', () => {
  assert.equal(caretOf('12+34['), 0);
  assert.equal(caretOf('12+34[]'), 5);
});

test('locate says which token the caret is in, and where', () => {
  const tokens = run('12+3').tokens;
  assert.deepEqual(locate(tokens, 0), { index: 0, offset: 0 }, 'before the 12');
  assert.deepEqual(locate(tokens, 1), { index: 0, offset: 1 }, 'inside it');
  assert.deepEqual(locate(tokens, 2), { index: 1, offset: 0 }, 'its end is the +\'s start');
  assert.deepEqual(locate(tokens, 4), { index: 3, offset: 0 }, 'and the end is past everything');
});

test('a digit typed at the caret goes in there', () => {
  assert.equal(shown('123L9'), '1,293');
  assert.equal(shown('123LL9'), '1,923');
  assert.equal(shown('123[9'), '9,123', 'at the front, it joins the number');
  assert.equal(preview('123L9'), 1293);
});

test('a digit inside a bracketed number joins it rather than multiplying it', () => {
  assert.equal(shown('(23)LLL9'), '(923)', 'not "(9 × 23)"');
  assert.equal(preview('(23)LLL9'), 923);
});

test('an operator typed inside a number splits it', () => {
  assert.equal(shown('123L+'), '12 + 3');
  assert.equal(preview('123L+'), 15);
  assert.equal(caretOf('123L+'), 3, 'with the caret after the operator');
});

test('an operator typed after an operator still corrects it', () => {
  assert.equal(shown('12+3L*'), '12 × 3', 'the caret sits right after the +');
});

test('a decimal point goes in at the caret', () => {
  assert.equal(shown('123L.'), '12.3');
  assert.equal(preview('123L.'), 12.3);
  assert.equal(shown('123L.L.'), '12.3', 'a number takes only one');
});

test('backspace deletes behind the caret, not off the end', () => {
  assert.equal(shown('123L<'), '13');
  assert.equal(caretOf('123L<'), 1);
  assert.equal(shown('123LL<'), '23');
  assert.equal(shown('123[<'), '123', 'at the front there is nothing behind it');
});

test('deleting an operator joins the numbers it separated', () => {
  // Left touching, "2" and "3" would be juxtaposition — a silent 2 × 3.
  assert.equal(shown('2+3L<'), '23');
  assert.equal(preview('2+3L<'), 23);
  assert.equal(caretOf('2+3L<'), 1, 'with the caret where the operator was');
});

test('joining two decimals leaves an expression that cannot be read yet', () => {
  // Honest rather than clever: "1.2" and "3.4" merged is "1.23.4", which is
  // not a number. The preview goes blank until it is edited into one.
  const calc = run('1.2+3.4LLL<');
  assert.equal(calc.state().preview, null);
  assert.equal(calc.state().expression, '1.23.4', 'shown as typed, not as "Error"');
  assert.equal(calc.caretMax, 6, 'and still editable a character at a time');
  calc.moveCaret(1);
  calc.moveCaret(1);
  calc.backspace();
  assert.equal(calc.state().expression, '1.234', 'so the stray point can be taken out');
  assert.equal(calc.state().preview, 1.234);
});

test('a postfix and a function act at the caret', () => {
  assert.equal(shown('12+34LLLq'), '12² + 34', 'squares the number behind the caret');
  assert.equal(shown('12+34LLLv'), '√(12) + 34');
});

test('a function takes the whole number the caret is inside', () => {
  // Half a number is not a value anyone means, so √ takes all of it.
  assert.equal(shown('144Lv'), '√(144)');
  assert.equal(caretOf('144Lv'), 6, 'with the caret past the closing bracket');
});

test('the parenthesis key reads the depth behind the caret', () => {
  assert.equal(shown('(12)LLLp'), '((12)', 'outside the group it opens');
  assert.equal(shown('(12)Lp'), '(12)', 'and inside a closed one it does not close twice');
});

test('a value pasted in from the history lands at the caret', () => {
  const calc = run('12+34LL');
  calc.insertValue(7);
  // Landing next to the 34 would have read as "734", so the × goes in.
  assert.equal(calc.state().expression, '12 + 7 × 34');
});

test('the caret goes to the end of whatever replaces the expression', () => {
  assert.equal(caretOf('2+3='), 1, 'a result is one number');
  assert.equal(caretOf('12+3=<'), 0, 'clearing it empties everything');

  const calc = new Calculator();
  calc.loadTokens(run('12*34=').state().committedTokens);
  assert.equal(calc.state().caret, calc.state().caretMax);
});

test('moving into a finished result makes it editable again', () => {
  const calc = run('2+3=');
  assert.equal(calc.state().committed, '2 + 3');
  calc.moveCaret(-1);
  assert.equal(calc.state().committed, null, 'no longer a finished answer');
  calc.digit('7');
  assert.equal(calc.state().expression, '75', 'so its digits can be corrected');
});

test('the caret survives an expression getting shorter underneath it', () => {
  const calc = run('12345');
  calc.caretEnd();
  calc.clearAll();
  assert.equal(calc.state().caret, 0);
});
