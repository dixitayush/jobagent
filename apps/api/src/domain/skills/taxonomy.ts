/**
 * Skill taxonomy (PRD §26). Canonical skill → category, optional parent, aliases.
 * Seeded into `skills` / `skill_aliases`; also used in-process for fast deterministic
 * extraction and normalization so no LLM call is needed for common synonyms.
 */
export interface SkillDef {
  name: string;
  category: string;
  parent?: string;
  aliases?: string[];
}

export const SKILL_TAXONOMY: SkillDef[] = [
  // Languages
  { name: "Java", category: "language", aliases: ["java se", "java ee", "core java", "java 8", "java 11", "java 17", "java 21", "j2ee", "jakarta ee"] },
  { name: "JavaScript", category: "language", aliases: ["js", "ecmascript", "es6", "vanilla js"] },
  { name: "TypeScript", category: "language", aliases: ["ts"] },
  { name: "Python", category: "language", aliases: ["python3", "python 3"] },
  { name: "Go", category: "language", aliases: ["golang"] },
  { name: "Rust", category: "language" },
  { name: "C", category: "language", aliases: ["ansi c"] },
  { name: "C++", category: "language", aliases: ["cpp", "c plus plus"] },
  { name: "C#", category: "language", aliases: ["c sharp", "csharp"] },
  { name: "Kotlin", category: "language" },
  { name: "Scala", category: "language" },
  { name: "Ruby", category: "language" },
  { name: "PHP", category: "language" },
  { name: "Swift", category: "language" },
  { name: "Objective-C", category: "language", aliases: ["objective c", "objc"] },
  { name: "Dart", category: "language" },
  { name: "R", category: "language", aliases: ["r language", "r programming"] },
  { name: "SQL", category: "language", aliases: ["structured query language"] },
  { name: "Bash", category: "language", aliases: ["shell scripting", "shell script", "bash scripting"] },
  { name: "Elixir", category: "language" },

  // Backend frameworks
  { name: "Spring", category: "framework", parent: "Java", aliases: ["spring framework", "spring mvc", "spring core"] },
  { name: "Spring Boot", category: "framework", parent: "Spring", aliases: ["springboot", "spring boot framework", "spring-boot"] },
  { name: "Spring Security", category: "framework", parent: "Spring" },
  { name: "Spring Cloud", category: "framework", parent: "Spring" },
  { name: "Hibernate", category: "framework", parent: "Java", aliases: ["jpa", "hibernate orm", "spring data jpa"] },
  { name: "Node.js", category: "runtime", parent: "JavaScript", aliases: ["nodejs", "node js", "node"] },
  { name: "Express.js", category: "framework", parent: "Node.js", aliases: ["express", "expressjs"] },
  { name: "NestJS", category: "framework", parent: "Node.js", aliases: ["nest.js", "nest js"] },
  { name: "Django", category: "framework", parent: "Python" },
  { name: "Flask", category: "framework", parent: "Python" },
  { name: "FastAPI", category: "framework", parent: "Python", aliases: ["fast api"] },
  { name: "Ruby on Rails", category: "framework", parent: "Ruby", aliases: ["rails", "ror"] },
  { name: ".NET", category: "framework", parent: "C#", aliases: ["dotnet", ".net core", "asp.net", "asp.net core", "dot net"] },
  { name: "Laravel", category: "framework", parent: "PHP" },
  { name: "gRPC", category: "protocol", aliases: ["grpc"] },
  { name: "GraphQL", category: "protocol", aliases: ["graph ql"] },
  { name: "REST APIs", category: "protocol", aliases: ["rest", "restful", "rest api", "restful apis", "restful services", "rest services"] },
  { name: "Microservices", category: "architecture", aliases: ["microservice", "micro services", "microservice architecture"] },
  { name: "Distributed Systems", category: "architecture", aliases: ["distributed computing"] },
  { name: "System Design", category: "architecture", aliases: ["systems design", "high level design", "low level design"] },
  { name: "Event-Driven Architecture", category: "architecture", aliases: ["event driven", "event-driven", "event sourcing"] },

  // Frontend
  { name: "React", category: "framework", parent: "JavaScript", aliases: ["react.js", "reactjs", "react js"] },
  { name: "Next.js", category: "framework", parent: "React", aliases: ["nextjs", "next js"] },
  { name: "Redux", category: "library", parent: "React", aliases: ["redux toolkit"] },
  { name: "Angular", category: "framework", parent: "TypeScript", aliases: ["angularjs", "angular.js", "angular 2+"] },
  { name: "Vue.js", category: "framework", parent: "JavaScript", aliases: ["vue", "vuejs", "vue js", "nuxt"] },
  { name: "Svelte", category: "framework", parent: "JavaScript" },
  { name: "HTML", category: "web", aliases: ["html5"] },
  { name: "CSS", category: "web", aliases: ["css3", "scss", "sass", "less"] },
  { name: "Tailwind CSS", category: "web", parent: "CSS", aliases: ["tailwind", "tailwindcss"] },
  { name: "React Native", category: "mobile", parent: "React", aliases: ["react-native"] },
  { name: "Flutter", category: "mobile", parent: "Dart" },
  { name: "Android", category: "mobile", aliases: ["android sdk", "android development"] },
  { name: "iOS", category: "mobile", aliases: ["ios development", "uikit", "swiftui"] },

  // Data stores
  { name: "PostgreSQL", category: "database", parent: "SQL", aliases: ["postgres", "postgresql", "psql", "pg"] },
  { name: "MySQL", category: "database", parent: "SQL", aliases: ["my sql", "mariadb"] },
  { name: "Oracle Database", category: "database", parent: "SQL", aliases: ["oracle db", "oracle", "pl/sql", "plsql"] },
  { name: "SQL Server", category: "database", parent: "SQL", aliases: ["mssql", "ms sql", "microsoft sql server", "t-sql"] },
  { name: "MongoDB", category: "database", aliases: ["mongo", "mongo db"] },
  { name: "Redis", category: "database", aliases: ["redis cache"] },
  { name: "Cassandra", category: "database", aliases: ["apache cassandra"] },
  { name: "DynamoDB", category: "database", parent: "AWS", aliases: ["dynamo db", "amazon dynamodb"] },
  { name: "Elasticsearch", category: "database", aliases: ["elastic search", "elk", "opensearch"] },
  { name: "Snowflake", category: "data", aliases: ["snowflake db"] },
  { name: "BigQuery", category: "data", parent: "GCP", aliases: ["big query", "google bigquery"] },

  // Messaging / data engineering
  { name: "Kafka", category: "messaging", aliases: ["apache kafka", "kafka streams"] },
  { name: "RabbitMQ", category: "messaging", aliases: ["rabbit mq"] },
  { name: "Apache Spark", category: "data", aliases: ["spark", "pyspark", "spark sql"] },
  { name: "Hadoop", category: "data", aliases: ["apache hadoop", "hdfs", "hive"] },
  { name: "Airflow", category: "data", aliases: ["apache airflow"] },
  { name: "dbt", category: "data", aliases: ["data build tool"] },
  { name: "ETL", category: "data", aliases: ["elt", "etl pipelines", "data pipelines"] },

  // Cloud & DevOps
  { name: "AWS", category: "cloud", aliases: ["amazon web services", "aws cloud"] },
  { name: "Amazon EC2", category: "cloud", parent: "AWS", aliases: ["ec2", "aws ec2"] },
  { name: "Amazon S3", category: "cloud", parent: "AWS", aliases: ["s3", "aws s3"] },
  { name: "AWS Lambda", category: "cloud", parent: "AWS", aliases: ["lambda", "aws lambda functions"] },
  { name: "Amazon ECS", category: "cloud", parent: "AWS", aliases: ["ecs", "aws ecs", "fargate", "aws fargate"] },
  { name: "Amazon EKS", category: "cloud", parent: "AWS", aliases: ["eks", "aws eks"] },
  { name: "Amazon RDS", category: "cloud", parent: "AWS", aliases: ["rds", "aws rds", "aurora"] },
  { name: "Amazon SQS", category: "cloud", parent: "AWS", aliases: ["sqs", "aws sqs", "sns"] },
  { name: "GCP", category: "cloud", aliases: ["google cloud", "google cloud platform"] },
  { name: "Azure", category: "cloud", aliases: ["microsoft azure", "azure cloud"] },
  { name: "Docker", category: "devops", aliases: ["containers", "containerization", "dockerfile"] },
  { name: "Kubernetes", category: "devops", aliases: ["k8s", "kube", "helm"] },
  { name: "Terraform", category: "devops", aliases: ["hcl", "infrastructure as code", "iac"] },
  { name: "Ansible", category: "devops" },
  { name: "Jenkins", category: "devops" },
  { name: "GitHub Actions", category: "devops", aliases: ["github actions ci"] },
  { name: "CI/CD", category: "devops", aliases: ["ci cd", "continuous integration", "continuous delivery", "continuous deployment"] },
  { name: "Git", category: "tool", aliases: ["github", "gitlab", "bitbucket", "version control"] },
  { name: "Linux", category: "os", aliases: ["unix", "ubuntu", "rhel", "centos"] },
  { name: "Prometheus", category: "observability" },
  { name: "Grafana", category: "observability" },
  { name: "OpenTelemetry", category: "observability", aliases: ["otel"] },
  { name: "Datadog", category: "observability" },
  { name: "Nginx", category: "devops" },

  // Testing
  { name: "JUnit", category: "testing", parent: "Java", aliases: ["junit5", "junit 5", "mockito"] },
  { name: "Jest", category: "testing", parent: "JavaScript" },
  { name: "Cypress", category: "testing" },
  { name: "Playwright", category: "testing" },
  { name: "Selenium", category: "testing", aliases: ["selenium webdriver"] },
  { name: "Test Automation", category: "testing", aliases: ["automation testing", "qa automation"] },
  { name: "TDD", category: "practice", aliases: ["test driven development", "test-driven development"] },

  // ML / AI
  { name: "Machine Learning", category: "ml", aliases: ["ml", "machine-learning"] },
  { name: "Deep Learning", category: "ml", parent: "Machine Learning", aliases: ["dl", "neural networks"] },
  { name: "TensorFlow", category: "ml", parent: "Machine Learning", aliases: ["tensor flow", "keras"] },
  { name: "PyTorch", category: "ml", parent: "Machine Learning", aliases: ["torch"] },
  { name: "scikit-learn", category: "ml", parent: "Machine Learning", aliases: ["sklearn", "scikit learn"] },
  { name: "NLP", category: "ml", parent: "Machine Learning", aliases: ["natural language processing"] },
  { name: "Computer Vision", category: "ml", parent: "Machine Learning", aliases: ["cv", "opencv"] },
  { name: "LLMs", category: "ml", parent: "Machine Learning", aliases: ["llm", "large language models", "generative ai", "genai", "gen ai", "rag", "langchain"] },
  { name: "Pandas", category: "data", parent: "Python", aliases: ["numpy"] },
  { name: "Data Analysis", category: "data", aliases: ["data analytics", "analytics"] },
  { name: "Tableau", category: "data", aliases: ["power bi", "powerbi", "looker"] },

  // Practices / other
  { name: "Agile", category: "practice", aliases: ["scrum", "kanban", "agile methodologies"] },
  { name: "OOP", category: "practice", aliases: ["object oriented programming", "object-oriented programming", "ood", "object oriented design"] },
  { name: "Design Patterns", category: "practice", aliases: ["solid principles", "solid"] },
  { name: "Data Structures & Algorithms", category: "practice", aliases: ["dsa", "data structures", "algorithms"] },
  { name: "Multithreading", category: "practice", aliases: ["concurrency", "multi-threading"] },
  { name: "Security", category: "practice", aliases: ["application security", "appsec", "owasp", "cybersecurity"] },
  { name: "OAuth", category: "security", aliases: ["oauth2", "oauth 2.0", "openid connect", "oidc", "jwt"] },
  { name: "Performance Tuning", category: "practice", aliases: ["performance optimization", "jvm tuning"] },
  { name: "Product Management", category: "business", aliases: ["product manager", "roadmapping"] },
  { name: "Figma", category: "design", aliases: ["ui/ux", "ux design", "ui design"] },
  { name: "Salesforce", category: "platform", aliases: ["apex", "sfdc"] },
  { name: "SAP", category: "platform", aliases: ["sap abap", "abap", "sap hana"] },

  // Soft skills
  { name: "Communication", category: "soft", aliases: ["communication skills", "verbal communication", "written communication"] },
  { name: "Leadership", category: "soft", aliases: ["team leadership", "people management", "mentoring", "mentorship"] },
  { name: "Problem Solving", category: "soft", aliases: ["problem-solving", "analytical skills"] },
  { name: "Collaboration", category: "soft", aliases: ["teamwork", "team player", "cross-functional collaboration"] },
  { name: "Stakeholder Management", category: "soft", aliases: ["stakeholder communication"] },
];

const SOFT_CATEGORIES = new Set(["soft"]);

interface Index {
  aliasToCanonical: Map<string, string>;
  canonical: Map<string, SkillDef>;
  patterns: { canonical: string; regex: RegExp }[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Aliases too ambiguous to match inside free text (they are still normalized when given as a skill). */
const TEXT_UNSAFE_ALIASES = new Set(["r", "c", "go", "ts", "js", "pg", "node", "rest", "spark", "lambda", "s3", "ml", "dl", "cv", "oracle", "express", "torch", "solid", "kube", "rails", "mongo", "vue", "sns", "rds", "ecs", "eks", "elk", "hive", "unix", "analytics", "containers", "algorithms", "data structures", "concurrency", "security", "helm", "less", "llm", "rag", "iac", "hcl", "dsa", "ood"]);

function buildIndex(defs: SkillDef[]): Index {
  const aliasToCanonical = new Map<string, string>();
  const canonical = new Map<string, SkillDef>();
  const patterns: Index["patterns"] = [];
  for (const def of defs) {
    canonical.set(def.name, def);
    const all = [def.name, ...(def.aliases ?? [])];
    for (const alias of all) aliasToCanonical.set(alias.toLowerCase(), def.name);
    const textAliases = all.filter((a) => !TEXT_UNSAFE_ALIASES.has(a.toLowerCase()));
    // "Go" and "R" are only matched in text by explicit phrasing ("golang", "r programming").
    if (textAliases.length === 0) continue;
    const alt = textAliases
      .sort((a, b) => b.length - a.length)
      .map((a) => escapeRe(a.toLowerCase()).replace(/\\ /g, "[\\s-]+").replace(/ /g, "[\\s-]+"))
      .join("|");
    // Custom boundaries: tokens like "C++", "C#", ".NET", "Node.js" end in non-word chars.
    patterns.push({ canonical: def.name, regex: new RegExp(`(?<![a-z0-9+#.])(?:${alt})(?![a-z0-9+#]|\\.[a-z])`, "i") });
  }
  return { aliasToCanonical, canonical, patterns };
}

const index = buildIndex(SKILL_TAXONOMY);

/** Returns the canonical skill for a raw string, or a cleaned version of the input when unknown. */
export function normalizeSkill(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, " ").replace(/[;,]+$/, "");
  if (!cleaned) return "";
  return index.aliasToCanonical.get(cleaned.toLowerCase()) ?? cleaned;
}

export function isKnownSkill(name: string): boolean {
  return index.aliasToCanonical.has(name.trim().toLowerCase());
}

export function isSoftSkill(name: string): boolean {
  const def = index.canonical.get(normalizeSkill(name));
  return def ? SOFT_CATEGORIES.has(def.category) : false;
}

export function normalizeSkills(raw: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const r of raw) {
    const n = normalizeSkill(r);
    if (n) out.add(n);
  }
  return [...out];
}

/** Deterministic skill extraction from free text using the taxonomy. */
/**
 * "Go" is too common an English word to match freely; accept it (capitalised, case-sensitive) only in
 * a list position — next to a comma, slash, "or"/"and", or parentheses — e.g. "Java, Go, or Ruby".
 */
const GO_IN_LIST = /(?:[,/(]\s*|\b(?:or|and)\s+)Go\b(?![-\s]+(?:to|live|ahead|beyond|forward)\b)|\bGo\s*(?:,|\/|\)|\s(?:or|and)\b)/;

export function extractSkillsFromText(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const p of index.patterns) if (p.regex.test(lower)) found.push(p.canonical);
  if (!found.includes("Go") && GO_IN_LIST.test(text)) found.push("Go");
  return found;
}

/** Ancestors of a skill (e.g. Spring Boot → Spring → Java). Used for inferred-skill credit. */
export function skillAncestors(name: string): string[] {
  const out: string[] = [];
  let cur = index.canonical.get(normalizeSkill(name));
  const seen = new Set<string>();
  while (cur?.parent && !seen.has(cur.parent)) {
    seen.add(cur.parent);
    out.push(cur.parent);
    cur = index.canonical.get(cur.parent);
  }
  return out;
}

export const skillKey = (s: string) => normalizeSkill(s).toLowerCase();
