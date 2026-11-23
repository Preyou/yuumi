import { existsSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import process from 'node:process'

type DocumentType = 'overall-design' | 'detailed-design' | 'implementation'

interface RelationRef {
  id: string
  path: string
}

interface DocumentMetadata {
  schema_version: number
  document_type: DocumentType
  id: string
  title: string
  status: string
  relations: Record<string, RelationRef[]>
  code_roots?: string[]
}

interface DesignDocument {
  absolutePath: string
  relativePath: string
  body: string
  headings: Set<string>
  metadata: DocumentMetadata
}

interface IndexEntry {
  id: string
  line: number
  relationIds: string[]
  status: string
  targetPath: string
  title: string
}

const workspaceRoot = resolve(import.meta.dir, '..')
const docsRoot = resolve(workspaceRoot, 'docs')

const layerDirectories: Record<DocumentType, string> = {
  'detailed-design': resolve(docsRoot, 'detailed-design'),
  'implementation': resolve(docsRoot, 'implementation'),
  'overall-design': resolve(docsRoot, 'overall-design'),
}

const allowedStatuses: Record<DocumentType, Set<string>> = {
  'detailed-design': new Set(['草案', '待确认', '已确认', '已废弃']),
  'implementation': new Set(['草案', '可开发', '实施中', '已完成', '已废弃']),
  'overall-design': new Set(['构想', '已规划', '已废弃']),
}

const idPatterns: Record<DocumentType, RegExp> = {
  'detailed-design': /^[A-Z]{3}-\d{3}$/,
  'implementation': /^IMP-[A-Z]{3,}-\d{3}[A-Z]?$/,
  'overall-design': /^OD-\d{3}$/,
}

const requiredHeadings: Record<DocumentType, string[]> = {
  'detailed-design': [
    '用户目标',
    '业务术语',
    '业务角色与权限',
    '前置条件',
    '业务输入与输出',
    '正常业务流程',
    '业务规则与状态变化',
    '架构与技术约束',
    '模块职责与依赖',
    '代码行为要求',
    '业务边界',
    '业务异常情况',
    '范围取舍与非目标',
    '明确禁止的业务行为',
    '验收条件',
  ],
  'implementation': [
    '目标与范围',
    '详细设计逐项落实',
    '技术约束与非目标',
    '代码结构与模块落位',
    '接口实现契约',
    '数据实现',
    '组件实现',
    '控制流程',
    '权限与安全',
    '状态一致性、事务与并发',
    '代码边界',
    '技术异常处理',
    '外部依赖',
    '性能与资源限制',
    '日志、监控与脱敏',
    '迁移、兼容与回滚',
    '验证方案',
    '实施顺序',
    '完成条件',
  ],
  'overall-design': ['目标', '产品边界', '模块与能力', '当前范围之外', '废弃说明'],
}

const forbiddenHeadings: Partial<Record<DocumentType, string[]>> = {
  implementation: ['前置条件', '业务前置条件', '上游保证与实施前置条件'],
}

const ignoredDocumentNames = new Set(['INDEX.md', 'README.md', 'STANDARD.md', 'TEMPLATE.md'])
const allowedRelationKeys = new Set([
  'overall_design',
  'detailed_design',
  'implementation',
  'implementation_parent',
  'implementation_children',
])
const allowedMetadataKeys = new Set([
  'code_roots',
  'document_type',
  'id',
  'relations',
  'schema_version',
  'status',
  'title',
])

const relationTargetType: Record<string, DocumentType> = {
  detailed_design: 'detailed-design',
  implementation: 'implementation',
  implementation_children: 'implementation',
  implementation_parent: 'implementation',
  overall_design: 'overall-design',
}

const errors: string[] = []

function report(filePath: string, message: string): void {
  const shownPath = relative(workspaceRoot, filePath) || filePath
  errors.push(`${shownPath}: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractFrontMatter(filePath: string, text: string): { raw: unknown, body: string } | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)
  if (!match) {
    report(filePath, '缺少位于文件开头的 YAML Front Matter')
    return undefined
  }

  try {
    return {
      body: text.slice(match[0].length),
      raw: Bun.YAML.parse(match[1]),
    }
  }
  catch (error) {
    report(filePath, `YAML Front Matter 无法解析：${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

function parseRelations(filePath: string, value: unknown): Record<string, RelationRef[]> | undefined {
  if (!isRecord(value)) {
    report(filePath, '`relations` 必须是对象')
    return undefined
  }

  const relations: Record<string, RelationRef[]> = {}
  for (const [key, rawRefs] of Object.entries(value)) {
    if (!allowedRelationKeys.has(key)) {
      report(filePath, `存在不支持的关系类型：${key}`)
      continue
    }
    if (!Array.isArray(rawRefs)) {
      report(filePath, `关系 ${key} 必须是数组`)
      continue
    }

    const refs: RelationRef[] = []
    for (const [index, rawRef] of rawRefs.entries()) {
      if (!isRecord(rawRef) || typeof rawRef.id !== 'string' || typeof rawRef.path !== 'string') {
        report(filePath, `关系 ${key}[${index}] 必须包含字符串类型的 id 和 path`)
        continue
      }
      refs.push({ id: rawRef.id, path: rawRef.path })
    }
    relations[key] = refs
  }

  return relations
}

function parseMetadata(filePath: string, expectedType: DocumentType, raw: unknown): DocumentMetadata | undefined {
  if (!isRecord(raw)) {
    report(filePath, 'Front Matter 必须是对象')
    return undefined
  }

  let valid = true
  for (const key of Object.keys(raw)) {
    if (!allowedMetadataKeys.has(key)) {
      report(filePath, `存在不支持的元数据字段：${key}`)
      valid = false
    }
  }
  if (raw.schema_version !== 1) {
    report(filePath, '`schema_version` 必须为数字 1')
    valid = false
  }
  if (raw.document_type !== expectedType) {
    report(filePath, `\`document_type\` 必须为 \`${expectedType}\``)
    valid = false
  }
  if (typeof raw.id !== 'string' || !idPatterns[expectedType].test(raw.id)) {
    report(filePath, `\`id\` 不符合 ${expectedType} 的标识格式`)
    valid = false
  }
  if (typeof raw.title !== 'string' || raw.title.trim() === '') {
    report(filePath, '`title` 必须是非空字符串')
    valid = false
  }
  if (typeof raw.status !== 'string' || !allowedStatuses[expectedType].has(raw.status)) {
    report(filePath, `\`status\` 不是 ${expectedType} 允许的状态`)
    valid = false
  }

  const relations = parseRelations(filePath, raw.relations)
  if (!relations) {
    valid = false
  }

  let codeRoots: string[] | undefined
  if (raw.code_roots !== undefined) {
    if (expectedType !== 'implementation') {
      report(filePath, '只有实施文档可以声明 `code_roots`')
      valid = false
    }
    else if (!Array.isArray(raw.code_roots) || raw.code_roots.some(item => typeof item !== 'string')) {
      report(filePath, '`code_roots` 必须是字符串数组')
      valid = false
    }
    else {
      codeRoots = raw.code_roots as string[]
    }
  }

  if (!valid || !relations) {
    return undefined
  }

  return {
    code_roots: codeRoots,
    document_type: expectedType,
    id: raw.id as string,
    relations,
    schema_version: 1,
    status: raw.status as string,
    title: (raw.title as string).trim(),
  }
}

function extractHeadings(body: string): Set<string> {
  return new Set(body
    .split(/\r?\n/)
    .filter(line => line.startsWith('## '))
    .map(line => line.slice(3).trim())
    .filter(Boolean))
}

async function loadDocuments(): Promise<DesignDocument[]> {
  const documents: DesignDocument[] = []
  const glob = new Bun.Glob('**/*.md')

  for (const [expectedType, directory] of Object.entries(layerDirectories) as [DocumentType, string][]) {
    for await (const filePath of glob.scan({ absolute: true, cwd: directory, onlyFiles: true })) {
      const fileName = filePath.slice(filePath.lastIndexOf(sep) + 1)
      if (ignoredDocumentNames.has(fileName)) {
        continue
      }

      const text = await Bun.file(filePath).text()
      const frontMatter = extractFrontMatter(filePath, text)
      if (!frontMatter) {
        continue
      }

      const metadata = parseMetadata(filePath, expectedType, frontMatter.raw)
      if (!metadata) {
        continue
      }

      const expectedHeading = `${metadata.id} ${metadata.title}`
      const headingLine = frontMatter.body.split(/\r?\n/).find(line => line.startsWith('# '))
      const actualHeading = headingLine?.slice(2).trim()
      if (actualHeading !== expectedHeading) {
        report(filePath, `一级标题必须为 \`# ${expectedHeading}\``)
      }

      documents.push({
        absolutePath: resolve(filePath),
        body: frontMatter.body,
        headings: extractHeadings(frontMatter.body),
        metadata,
        relativePath: relative(workspaceRoot, filePath),
      })
    }
  }

  return documents
}

function validateUniqueIds(documents: DesignDocument[]): Map<string, DesignDocument> {
  const byId = new Map<string, DesignDocument>()
  for (const document of documents) {
    const existing = byId.get(document.metadata.id)
    if (existing) {
      report(document.absolutePath, `标识 ${document.metadata.id} 与 ${existing.relativePath} 重复`)
      continue
    }
    byId.set(document.metadata.id, document)
  }
  return byId
}

function isInsideDocs(targetPath: string): boolean {
  const pathFromDocs = relative(docsRoot, targetPath)
  return pathFromDocs !== '..' && !pathFromDocs.startsWith(`..${sep}`) && !pathFromDocs.startsWith(sep)
}

function inverseRelationKey(sourceType: DocumentType, relationType: string): string | undefined {
  if (sourceType === 'overall-design' && relationType === 'detailed_design') {
    return 'overall_design'
  }
  if (sourceType === 'detailed-design' && relationType === 'overall_design') {
    return 'detailed_design'
  }
  if (sourceType === 'detailed-design' && relationType === 'implementation') {
    return 'detailed_design'
  }
  if (sourceType === 'implementation' && relationType === 'detailed_design') {
    return 'implementation'
  }
  if (relationType === 'implementation_parent') {
    return 'implementation_children'
  }
  if (relationType === 'implementation_children') {
    return 'implementation_parent'
  }
  return undefined
}

async function validateRelations(documents: DesignDocument[], byId: Map<string, DesignDocument>): Promise<void> {
  const byPath = new Map(documents.map(document => [document.absolutePath, document]))

  for (const document of documents) {
    for (const [relationType, refs] of Object.entries(document.metadata.relations)) {
      const seen = new Set<string>()
      for (const ref of refs) {
        if (seen.has(ref.id)) {
          report(document.absolutePath, `关系 \`${relationType}\` 重复引用 ${ref.id}`)
          continue
        }
        seen.add(ref.id)

        const targetPath = resolve(dirname(document.absolutePath), ref.path)
        if (!isInsideDocs(targetPath)) {
          report(document.absolutePath, `关系 ${ref.id} 的路径超出 docs 目录：${ref.path}`)
          continue
        }
        if (!(await Bun.file(targetPath).exists())) {
          report(document.absolutePath, `关系 ${ref.id} 指向不存在的文件：${ref.path}`)
          continue
        }

        const targetByPath = byPath.get(targetPath)
        const targetById = byId.get(ref.id)
        if (!targetByPath) {
          report(document.absolutePath, `关系 ${ref.id} 的目标没有有效元数据：${ref.path}`)
          continue
        }
        if (targetByPath.metadata.id !== ref.id) {
          report(document.absolutePath, `关系路径 ${ref.path} 实际指向 ${targetByPath.metadata.id}，不是 ${ref.id}`)
        }
        if (targetById?.absolutePath !== targetPath) {
          report(document.absolutePath, `关系 ${ref.id} 的 path 与该标识实际文件不一致`)
        }

        const expectedTargetType = relationTargetType[relationType]
        if (targetByPath.metadata.document_type !== expectedTargetType) {
          report(document.absolutePath, `关系 \`${relationType}\` 不能指向 ${targetByPath.metadata.document_type}`)
        }

        const inverseKey = inverseRelationKey(document.metadata.document_type, relationType)
        if (!inverseKey) {
          report(document.absolutePath, `关系 ${relationType} 不适用于 ${document.metadata.document_type}`)
          continue
        }
        const inverseRefs = targetByPath.metadata.relations[inverseKey] ?? []
        if (!inverseRefs.some(inverse => inverse.id === document.metadata.id
          && resolve(dirname(targetByPath.absolutePath), inverse.path) === document.absolutePath)) {
          report(document.absolutePath, `关系 ${relationType} -> ${ref.id} 缺少对称的 \`${inverseKey}\` 关系`)
        }
      }
    }
  }
}

function relationCount(document: DesignDocument, key: string): number {
  return document.metadata.relations[key]?.length ?? 0
}

function validateRelationshipShape(documents: DesignDocument[], byId: Map<string, DesignDocument>): void {
  for (const document of documents) {
    const { document_type: type, relations, status } = document.metadata
    const relationKeys = Object.keys(relations)

    if (type === 'overall-design') {
      if (relationKeys.some(key => key !== 'detailed_design')) {
        report(document.absolutePath, '总体设计只能声明 `detailed_design` 关系')
      }
      if (status === '已规划' && relationCount(document, 'detailed_design') === 0) {
        report(document.absolutePath, '状态为 `已规划` 的总体设计必须关联至少一个详细设计')
      }
    }

    if (type === 'detailed-design') {
      if (relationKeys.some(key => key !== 'overall_design' && key !== 'implementation')) {
        report(document.absolutePath, '详细设计只能声明 `overall_design` 和 `implementation` 关系')
      }
      if (status !== '已废弃' && relationCount(document, 'overall_design') !== 1) {
        report(document.absolutePath, '有效详细设计必须关联且只关联一个总体设计')
      }
    }

    if (type === 'implementation') {
      const isChild = relationCount(document, 'implementation_parent') > 0
      if (isChild) {
        if (relationCount(document, 'implementation_parent') !== 1 || relationKeys.some(key => key !== 'implementation_parent')) {
          report(document.absolutePath, '子实施文档必须且只能声明一个 `implementation_parent` 关系')
        }
        const parentId = relations.implementation_parent?.[0]?.id
        const parent = parentId ? byId.get(parentId) : undefined
        if (parent && parent.metadata.status !== status) {
          report(document.absolutePath, `子实施文档状态必须与主文档 ${parentId} 一致`)
        }
      }
      else {
        if (relationKeys.some(key => key !== 'detailed_design' && key !== 'implementation_children')) {
          report(document.absolutePath, '主实施文档只能声明详细设计和子实施文档关系')
        }
        if (status !== '已废弃' && relationCount(document, 'detailed_design') === 0) {
          report(document.absolutePath, '有效主实施文档必须关联至少一个详细设计')
        }
        if (status === '可开发' || status === '实施中' || status === '已完成') {
          for (const ref of relations.detailed_design ?? []) {
            const detail = byId.get(ref.id)
            if (detail && detail.metadata.status !== '已确认') {
              report(document.absolutePath, `关联详细设计 ${ref.id} 必须为 \`已确认\`，当前为 \`${detail.metadata.status}\``)
            }
          }
        }
      }
    }
  }
}

function validateRequiredHeadings(documents: DesignDocument[], byId: Map<string, DesignDocument>): void {
  for (const document of documents) {
    for (const forbidden of forbiddenHeadings[document.metadata.document_type] ?? []) {
      if (document.headings.has(forbidden)) {
        report(document.absolutePath, `不得包含章节 \`## ${forbidden}\``)
      }
    }

    if (document.metadata.document_type === 'implementation'
      && relationCount(document, 'implementation_parent') > 0) {
      if (document.headings.size === 0) {
        report(document.absolutePath, '子实施文档至少需要一个二级章节')
      }
      continue
    }

    const headings = new Set(document.headings)
    if (document.metadata.document_type === 'implementation') {
      for (const childRef of document.metadata.relations.implementation_children ?? []) {
        const child = byId.get(childRef.id)
        if (child) {
          for (const heading of child.headings) {
            headings.add(heading)
          }
        }
      }
    }

    for (const required of requiredHeadings[document.metadata.document_type]) {
      if (!headings.has(required)) {
        report(document.absolutePath, `缺少必需章节 \`## ${required}\``)
      }
    }
  }
}

async function parseIndex(type: DocumentType): Promise<IndexEntry[]> {
  const indexPath = resolve(layerDirectories[type], 'INDEX.md')
  const text = await Bun.file(indexPath).text()
  const entries: IndexEntry[] = []

  for (const [zeroBasedLine, line] of text.split(/\r?\n/).entries()) {
    if (!line.startsWith('|')) {
      continue
    }
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim())
    if (cells.length < 3 || !idPatterns[type].test(cells[0])) {
      continue
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(cells[1])
    if (!link) {
      report(indexPath, `第 ${zeroBasedLine + 1} 行的文档链接格式无效`)
      continue
    }
    entries.push({
      id: cells[0],
      line: zeroBasedLine + 1,
      relationIds: Array.from(
        (cells[type === 'detailed-design' ? 4 : 3] ?? '').matchAll(/(?:IMP-)?[A-Z]{3,}-\d{3}[A-Z]?/g),
        match => match[0],
      ),
      status: cells[2],
      targetPath: resolve(dirname(indexPath), link[2]),
      title: link[1],
    })
  }

  return entries
}

async function validateIndexes(documents: DesignDocument[]): Promise<void> {
  const indexedPaths = new Set<string>()

  for (const type of Object.keys(layerDirectories) as DocumentType[]) {
    const indexPath = resolve(layerDirectories[type], 'INDEX.md')
    const entries = await parseIndex(type)
    const ids = new Set<string>()

    for (const entry of entries) {
      if (ids.has(entry.id)) {
        report(indexPath, `第 ${entry.line} 行重复登记 ${entry.id}`)
      }
      ids.add(entry.id)
      indexedPaths.add(entry.targetPath)

      const document = documents.find(candidate => candidate.absolutePath === entry.targetPath)
      if (!document) {
        report(indexPath, `第 ${entry.line} 行的 ${entry.id} 未指向具有有效元数据的正式文档`)
        continue
      }
      if (document.metadata.id !== entry.id) {
        report(indexPath, `第 ${entry.line} 行标识为 ${entry.id}，目标文档标识为 ${document.metadata.id}`)
      }
      if (document.metadata.title !== entry.title) {
        report(indexPath, `第 ${entry.line} 行标题与 ${entry.id} 元数据不一致`)
      }
      if (document.metadata.status !== entry.status) {
        report(indexPath, `第 ${entry.line} 行状态与 ${entry.id} 元数据不一致`)
      }

      const relationKey = type === 'overall-design'
        ? 'detailed_design'
        : type === 'detailed-design'
          ? 'implementation'
          : 'detailed_design'
      const expectedRelationIds = (document.metadata.relations[relationKey] ?? []).map(ref => ref.id).sort()
      const actualRelationIds = [...new Set(entry.relationIds)].sort()
      if (expectedRelationIds.join('\0') !== actualRelationIds.join('\0')) {
        report(indexPath, `第 ${entry.line} 行关系标识与 ${entry.id} 元数据的 \`${relationKey}\` 不一致`)
      }
    }
  }

  for (const document of documents) {
    const isImplementationChild = document.metadata.document_type === 'implementation'
      && relationCount(document, 'implementation_parent') > 0
    if (!isImplementationChild && !indexedPaths.has(document.absolutePath)) {
      report(document.absolutePath, '正式文档未登记到对应 INDEX.md')
    }
    if (isImplementationChild && indexedPaths.has(document.absolutePath)) {
      report(document.absolutePath, '子实施文档不应直接登记到 INDEX.md')
    }
  }
}

async function validateCodeRoots(documents: DesignDocument[]): Promise<void> {
  for (const document of documents) {
    for (const codeRoot of document.metadata.code_roots ?? []) {
      const targetPath = resolve(workspaceRoot, codeRoot)
      const pathFromWorkspace = relative(workspaceRoot, targetPath)
      if (pathFromWorkspace === '..' || pathFromWorkspace.startsWith(`..${sep}`) || pathFromWorkspace.startsWith(sep)) {
        report(document.absolutePath, `code_roots 路径超出工作区：${codeRoot}`)
        continue
      }
      if (!existsSync(targetPath)) {
        report(document.absolutePath, `code_roots 路径不存在：${codeRoot}`)
      }
    }
  }
}

async function main(): Promise<void> {
  const documents = await loadDocuments()
  const byId = validateUniqueIds(documents)

  await validateRelations(documents, byId)
  validateRelationshipShape(documents, byId)
  validateRequiredHeadings(documents, byId)
  await validateIndexes(documents)
  await validateCodeRoots(documents)

  if (errors.length > 0) {
    console.error(`文档合规检查失败，共 ${errors.length} 个问题：`)
    for (const error of errors.sort()) {
      console.error(`- ${error}`)
    }
    process.exitCode = 1
    return
  }

  console.info(`文档合规检查通过，共检查 ${documents.length} 份正式设计文档。`)
}

await main()
