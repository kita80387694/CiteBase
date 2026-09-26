# 内部实现契约

Java package `io.citebase`，Java 21 / Spring Boot 3.5.16 / Spring AI 1.1.8，Maven backend/。
PostgreSQL pgvector，JdbcTemplate；接口 JSON camelCase；数据库 snake_case。
认证：Bearer token，AuthService.require(HttpServletRequest) -> String userId；所有 owner id 为 String(UUID)。
通用失败 JSON {message}，HTTP 400/401/404/409/502。

## Core API
- POST /api/auth/login {username,password} -> {token,username,userId}
- GET /api/me -> {username,userId,mode}
- GET/POST /api/knowledge-bases，POST {name}，返回 {id,name,createdAt} 或数组
- DELETE /api/knowledge-bases/{id}
- GET /api/knowledge-bases/{id}/documents -> [{id,name,status,error,activeVersionId,createdAt}]
- POST /api/knowledge-bases/{id}/documents multipart file；可选 documentId 为更新；返回 {id,...}
- DELETE /api/documents/{id}
- GET /api/tasks -> [{id,documentId,documentName,status,attempts,error,createdAt}]
- POST /api/tasks/{id}/retry
- GET /api/documents/{id}/versions

## Shared services & schema
Core implements AuthService, AccessService.requireKnowledgeBase(String userId,String kbId), migration, ingestion.
RAG implements ModelGateway: `float[] embed(String text)`, `Generation generate(String question,List<Evidence> evidence)`, `String mode()`, `String chatModel()`, `String embeddingModel()`.
Evidence record fields: String id,documentId,documentName,versionId; int page,paragraph,startOffset,endOffset; String text; double score.
Generation record: String answer; Long promptTokens,completionTokens; String error (nullable).
RAG implements public static Lexical.tokens(String) -> String (space delimited Latin terms and Chinese bigrams).

Tables owned by core migration:
app_user(id text PK,username text unique,password_hash text)
auth_session(token_hash text PK,user_id text FK,expires_at timestamptz)
knowledge_base(id text PK,user_id text FK,name text,created_at timestamptz)
document(id text PK,kb_id text FK,name text,status text,error text nullable,active_version_id text nullable,created_at timestamptz)
document_version(id text PK,document_id text FK,content_hash text,source bytea,media_type text,status text,created_at timestamptz)
chunk(id text PK,version_id text FK,document_id text FK,page int,paragraph int,start_offset int,end_offset int,content text,content_hash text,embedding vector,lexical text,embedding_model text)
index_task(id text PK,document_id text FK,version_id text FK,status text,attempts int,error text nullable,available_at timestamptz,started_at timestamptz nullable,created_at timestamptz)
All cascades on document/kb deletion; active_version_id no circular FK. Embedding dimension dynamic, no ANN index MVP.
Core uses ModelGateway.embed, Lexical.tokens; reuses embedding by same document content_hash AND embedding_model.

## RAG & eval API (owned by RAG agent, migrations V2+)
- POST /api/questions {kbId,question,mode:"vector"|"hybrid",topK:5} -> QuestionResult
- GET /api/questions?kbId= -> list histories
- GET /api/citations/{chunkId} -> Evidence (owner + active document version required)
QuestionResult {id,question,answer,mode,modelMode,evidence:Evidence[],citations:Evidence[],citationValid,abstained,retrievalMs,totalMs,promptTokens,completionTokens,error}
- POST /api/evaluations {kbId,name,dataset:{version,questions:[{id,question,answerable,expectedAnswer,evidence:[{documentName,page,paragraph,quote}]}]},topK:5} -> run object
- GET /api/evaluations -> runs array
- GET /api/evaluations/{id} -> run object with results and summary
- GET /api/evaluations/{id}/export -> same full JSON attachment
Run {id,name,status,modelMode,config,summary,results,error,createdAt}; summary vector/hybrid -> {recallAtK,mrr,retrievalMs,totalMs,count}; result {caseId,question,mode,expectedAnswer,answerable,recallAtK,mrr,evidenceHit,answerCorrect,citationValid,...QuestionResult fields}
Evaluation synchronous acceptable but frontend loading; persisted RUNNING -> COMPLETED/FAILED, startup marks interrupted FAILED. Limit 200 cases.
Demo users alice / Alice-demo-123! and bob / Bob-demo-123!.
