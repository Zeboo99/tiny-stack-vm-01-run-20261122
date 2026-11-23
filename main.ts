// tiny-stack-vm-01-run-20261122: a tiny stack VM for make.fun's ISA v1.
// One run answers a whole set: for each /input/<id> it writes
// /output/<id>/stdout.bin (the bytes the program wrote) and
// /output/<id>/exit.txt (its exit code, decimal).
// Local run: MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
// Decimal form of a signed 32-bit int, written straight into `buf` at `at`
// (digits reversed in a fixed scratch buffer — no String, no TextEncoder,
// no per-print allocation). Returns the new offset, or -1 when the write
// would pass `cap`. No special case for INT_MIN: JS numbers are doubles,
// so -(-2147483648) is exactly 2147483648 and the digit loop below just works.
const scratch = new Uint8Array(12);
function writeInt(buf, at, cap, v) {
  let n = 0;
  let u = v < 0 ? -v : v;
  do { scratch[n++] = 48 + (u % 10); u = (u / 10) | 0; } while (u > 0);
  const len = n + (v < 0 ? 1 : 0);
  if (at + len > cap) return -1;
  if (v < 0) buf[at++] = 45;
  while (n > 0) buf[at++] = scratch[--n];
  return at;
}

// Runs one program on its input bytes; returns [stdout bytes, exit code].
// Every rule is ISA.md's, in the order it states them: step limit, pc range,
// unknown opcode, cut-off immediate, stack needs, then the op's own traps.
function run(p, inp) {
  const n = p.length;
  const D = new Int32Array(256);
  const C = new Int32Array(64);
  const M = new Int32Array(256);
  const out = new Uint8Array(65536);
  let sp = 0, cp = 0, ol = 0, ip = 0, pc = 0, steps = 0;
  const end = (code) => [out.slice(0, ol), code];
  for (;;) {
    if (steps === 1000000) return end(10);
    if (pc < 0 || pc >= n) return end(9);
    const op = p[pc];
    const ok = op <= 7 || (op >= 16 && op <= 34) || (op >= 48 && op <= 52) || (op >= 64 && op <= 65) || (op >= 80 && op <= 83);
    if (!ok) return end(5);
    const imm = op === 1 ? 1 : op === 2 ? 4 : op >= 48 && op <= 51 ? 2 : 0;
    if (pc + imm >= n) return end(9);
    steps++;
    const next = pc + 1 + imm;
    const pops = op === 3 || op === 4 ? 1 : op === 5 || op === 6 ? 2 : op === 7 ? 3
      : op >= 16 && op <= 34 ? (op === 23 || op === 27 ? 1 : 2)
      : op === 49 || op === 50 || op === 64 ? 1 : op === 65 ? 2
      : op === 80 || op === 81 || op === 83 ? 1 : 0;
    const pushes = op === 1 || op === 2 ? 1 : op === 4 || op === 5 ? 2 : op === 6 || op === 7 ? 3
      : op >= 16 && op <= 34 ? 1 : op === 64 || op === 82 ? 1 : 0;
    if (sp < pops) return end(2);
    if (sp - pops + pushes > 256) return end(3);
    pc = next;
    switch (op) {
      case 0: return end(0);
      case 1: D[sp++] = (p[next - 1] << 24) >> 24; break;
      case 2: D[sp++] = p[next - 4] | (p[next - 3] << 8) | (p[next - 2] << 16) | (p[next - 1] << 24); break;
      case 3: sp--; break;
      case 4: D[sp] = D[sp - 1]; sp++; break;
      case 5: { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; break; }
      case 6: D[sp] = D[sp - 2]; sp++; break;
      case 7: { const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a; break; }
      case 23: D[sp - 1] = -D[sp - 1] | 0; break;
      case 27: D[sp - 1] = ~D[sp - 1]; break;
      case 16: case 17: case 18: case 19: case 20: case 21: case 22:
      case 24: case 25: case 26: case 28: case 29: case 30:
      case 32: case 33: case 34: {
        const b = D[sp - 1], a = D[sp - 2];
        let r;
        if (op === 16) r = (a + b) | 0;
        else if (op === 17) r = (a - b) | 0;
        else if (op === 18) r = Math.imul(a, b);
        else if (op === 19) { if (b === 0) return end(4); r = a === -2147483648 && b === -1 ? a : (a / b) | 0; }
        else if (op === 20) { if (b === 0) return end(4); r = b === -1 ? 0 : (a % b) | 0; }
        else if (op === 21) { if (b === 0) return end(4); r = Math.floor((a >>> 0) / (b >>> 0)) | 0; }
        else if (op === 22) { if (b === 0) return end(4); r = ((a >>> 0) % (b >>> 0)) | 0; }
        else if (op === 24) r = a & b;
        else if (op === 25) r = a | b;
        else if (op === 26) r = a ^ b;
        else if (op === 28) r = a << (b & 31);
        else if (op === 29) r = a >> (b & 31);
        else if (op === 30) r = (a >>> (b & 31)) | 0;
        else if (op === 32) r = a === b ? 1 : 0;
        else if (op === 33) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        sp -= 2; D[sp++] = r; break;
      }
      case 48: case 49: case 50: {
        const rel = ((p[next - 2] | (p[next - 1] << 8)) << 16) >> 16;
        let take = true;
        if (op !== 48) { const v = D[--sp]; take = op === 49 ? v === 0 : v !== 0; }
        if (take) pc = next + rel;
        break;
      }
      case 51:
        if (cp === 64) return end(7);
        C[cp++] = next;
        pc = p[next - 2] | (p[next - 1] << 8);
        break;
      case 52:
        if (cp === 0) return end(8);
        pc = C[--cp];
        break;
      case 64: {
        const a = D[sp - 1];
        if (a < 0 || a >= 256) return end(6);
        D[sp - 1] = M[a];
        break;
      }
      case 65: {
        const a = D[sp - 1], v = D[sp - 2];
        if (a < 0 || a >= 256) return end(6);
        sp -= 2; M[a] = v;
        break;
      }
      case 80: {
        const no = writeInt(out, ol, 65536, D[sp - 1]);
        if (no < 0) return end(11);
        sp--; ol = no;
        break;
      }
      case 81:
        if (ol + 1 > 65536) return end(11);
        out[ol++] = D[--sp] & 255;
        break;
      case 82: D[sp++] = ip < inp.length ? inp[ip++] : -1; break;
      case 83: return end(D[--sp] & 255);
    }
  }
}

for (const id of readdirSync(IN).sort()) {
  const dir = join(IN, id);
  const prog = new Uint8Array(readFileSync(join(dir, 'program.bin')));
  const input = existsSync(join(dir, 'input.bin')) ? new Uint8Array(readFileSync(join(dir, 'input.bin'))) : new Uint8Array(0);
  const [stdout, code] = run(prog, input);
  mkdirSync(join(OUT, id), { recursive: true });
  writeFileSync(join(OUT, id, 'stdout.bin'), stdout);
  writeFileSync(join(OUT, id, 'exit.txt'), code + '\n');
}
