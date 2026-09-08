import { createHash } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const contractDirectory = resolve(root, 'src', 'adapters', 'overcore', 'contracts')
const generatedDirectory = resolve(root, 'src', 'adapters', 'overcore', 'generated')
const requestPath = resolve(contractDirectory, 'authorization-request-v1.schema.json')
const decisionPath = resolve(contractDirectory, 'authorization-decision-v1.schema.json')
const targetPath = resolve(generatedDirectory, 'authorization-contract-v1.ts')

if (dirname(targetPath) !== generatedDirectory) throw new Error('Destino gerado fora do diretório permitido.')

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`
}

const request = JSON.parse(await readFile(requestPath, 'utf8'))
const decision = JSON.parse(await readFile(decisionPath, 'utf8'))
const action = request.$defs.actionAuthorizationRequest
const metadata = {
  requestSchemaSha256: digest(request),
  decisionSchemaSha256: digest(decision),
  requestKeys: Object.keys(request.properties),
  actionKeys: Object.keys(action.properties),
  identifierPattern: request.$defs.identifier.pattern,
  operationPattern: request.$defs.operationToken.pattern,
  effectKeyPattern: action.properties.effectKey.pattern,
  controls: request.$defs.control.enum,
  boundaries: request.$defs.boundary.enum,
  risks: request.$defs.riskSummary.properties.maximumRisk.enum,
  effectClasses: action.properties.effectClass.enum
}
const content = `// Gerado por scripts/generate-authority-contract.mjs. Não edite manualmente.\nexport const authorizationContractV1 = ${JSON.stringify(metadata, null, 2)} as const\n`

if (process.argv.includes('--write')) {
  const temporary = `${targetPath}.${process.pid}.tmp`
  try {
    await writeFile(temporary, content, 'utf8')
    await rename(temporary, targetPath)
  } finally {
    await rm(temporary, { force: true })
  }
} else {
  const current = await readFile(targetPath, 'utf8')
  if (current !== content) throw new Error('Contrato gerado está desatualizado; execute npm run generate:authority.')
}
