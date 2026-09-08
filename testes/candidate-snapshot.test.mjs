import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createCandidateSnapshot, verifyCandidateSnapshot } from '../scripts/create-candidate-snapshot.mjs'

test('snapshot captura WIP, arquivo novo e exclusão sem mudar Git; verifica adulteração', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omni-snapshot-test-'))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding:'utf8', windowsHide:true, stdio:['ignore','pipe','pipe'] })
  try {
    git('init')
    git('config','user.email','snapshot@example.invalid')
    git('config','user.name','Snapshot test')
    await writeFile(join(root,'.gitignore'), 'out/\n/memory/\n')
    await writeFile(join(root,'existing.txt'), 'baseline')
    await writeFile(join(root,'deleted.txt'), 'baseline')
    git('add','.')
    git('commit','-m','fixture')
    await writeFile(join(root,'existing.txt'), 'reviewable WIP')
    await writeFile(join(root,'new.txt'), 'new candidate')
    await rm(join(root,'deleted.txt'))
    await mkdir(join(root,'memory'))
    await writeFile(join(root,'memory','private.txt'), 'private data excluded')
    await mkdir(join(root,'src','core','memory'), { recursive:true })
    await writeFile(join(root,'src','core','memory','capture.ts'), 'export const schemaVersion = 1')
    await mkdir(join(root,'out'))
    const before = git('status','--porcelain')
    const captured = await createCandidateSnapshot(root, join(root,'out','candidate'))
    assert.equal(await readFile(join(captured.destination,'source','existing.txt'),'utf8'), 'reviewable WIP')
    assert.equal(await readFile(join(captured.destination,'source','new.txt'),'utf8'), 'new candidate')
    assert.equal(await readFile(join(captured.destination,'source','src','core','memory','capture.ts'),'utf8'), 'export const schemaVersion = 1')
    await assert.rejects(readFile(join(captured.destination,'source','deleted.txt')), {code:'ENOENT'})
    await assert.rejects(readFile(join(captured.destination,'source','memory','private.txt')), {code:'ENOENT'})
    assert.equal(git('status','--porcelain'), before)
    assert.equal(await verifyCandidateSnapshot(captured.destination), captured.sourceFingerprint)
    await writeFile(join(captured.destination,'source','new.txt'), 'tampered')
    await assert.rejects(verifyCandidateSnapshot(captured.destination), /content changed/)
    await assert.rejects(createCandidateSnapshot(root, join(root,'outside-out')), /below workspace/)
  } finally { await rm(root, {recursive:true, force:true}) }
})
