'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

// Tiny .env loader (no extra dependency). Real environment variables always win.
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envFile.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch { /* no .env file — fine */ }

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || null;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
// Override to use any OpenAI-compatible endpoint (or a local mock when testing).
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
// Override to use a different Gemini endpoint (or a local mock when testing).
const GEMINI_BASE_URL = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
// Backup models, tried in order when GEMINI_MODEL is overloaded or unavailable. Comma-separated;
// set it to an empty string to turn backups off.
const GEMINI_FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-flash-lite-latest,gemini-2.5-flash')
  .split(',').map(s => s.trim()).filter(Boolean);
const GEMINI_MODELS = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS.filter(m => m !== GEMINI_MODEL)];
// Retry tuning (the defaults suit production; the env overrides exist mainly for tests).
const GEMINI_ATTEMPTS_PER_MODEL = 2;
const GEMINI_RETRY_DELAY_MS = Number(process.env.GEMINI_RETRY_DELAY_MS ?? 400);
const GEMINI_DEADLINE_MS = Number(process.env.GEMINI_DEADLINE_MS ?? 12000); // stop starting new attempts after this
const GEMINI_RETRY_STATUSES = new Set([429, 500, 502, 503, 504]); // temporary: retry, then try the next model

// Which provider answers chat: 'openai' | 'gemini' | 'demo' (canned replies, no key needed).
// By default it follows whichever key is set (OpenAI first if both are). Set LLM_PROVIDER to
// openai, gemini or demo to force one; forcing a provider whose key is missing gives demo.
function pickProvider() {
  const want = (process.env.LLM_PROVIDER || '').toLowerCase();
  if (want === 'demo') return 'demo';
  if (want === 'openai') return OPENAI_API_KEY ? 'openai' : 'demo';
  if (want === 'gemini') return GEMINI_API_KEY ? 'gemini' : 'demo';
  return OPENAI_API_KEY ? 'openai' : GEMINI_API_KEY ? 'gemini' : 'demo';
}
const PROVIDER = pickProvider();
const PROVIDER_MODEL = PROVIDER === 'gemini' ? GEMINI_MODEL : OPENAI_MODEL;

const MAX_MESSAGE_CHARS = 4000;   // per new user message
const MAX_HISTORY_MESSAGES = 20;  // earlier messages accepted from the browser and sent to the model
const MAX_HISTORY_CHARS = 8000;   // per earlier message (longer ones are truncated)
const RATE_LIMIT = { windowMs: 60 * 1000, max: 20 }; // chat requests per IP per window

const app = express();
app.set('trust proxy', 1); // Render / Railway / Fly / Vercel sit behind one proxy
app.disable('x-powered-by');
app.use(cors());
// History (up to 20 x 8000 chars, some multi-byte) rides along with each chat request.
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================
//  AGENT REGISTRY (42 Agents)
// ============================
const AGENTS = [
  // Support
  { id: 'customer-support', name: 'Customer Support Specialist', category: 'Support', description: 'Resolves tickets, answers FAQs, handles refunds.', icon: '🎧', color: '#3b82f6', gradient: 'from-blue-500 to-indigo-600', systemPrompt: 'You are an empathetic Customer Support Specialist. Help resolve issues, track orders, and process refunds.', greeting: `Hello! I'm your Customer Support Specialist. I can help with account issues, billing, refunds, and troubleshooting. How can I assist you today?`, tools: ['knowledge_base', 'ticket_system'], mostUsed: true, useCase: 'E-commerce, SaaS' },
  // Development
  { id: 'coding-assistant', name: 'Full-Stack Coding Assistant', category: 'Development', description: 'Writes, debugs, and optimizes code in 20+ languages.', icon: '💻', color: '#10b981', gradient: 'from-emerald-400 to-teal-600', systemPrompt: 'You are an expert Full-Stack Engineer. Write clean code in JavaScript, Python, React, Node, SQL, and more.', greeting: `I'm your Full-Stack Coding Assistant. I can write, debug, and refactor code in JavaScript, Python, React, Node.js, SQL, and more. What would you like me to build?`, tools: ['code_interpreter', 'web_search'], mostUsed: true, useCase: 'Startups, Developers' },
  // Content
  { id: 'content-writer', name: 'AI Content Writer', category: 'Content', description: 'Creates blogs, ads, emails, and social posts.', icon: '✍️', color: '#f59e0b', gradient: 'from-amber-400 to-orange-600', systemPrompt: 'You are a professional copywriter. Write SEO-friendly blogs, ad copy, newsletters, and social posts.', greeting: `I'm your AI Content Writer. I can create blog posts, ad copy, email sequences, and social media captions. What should I write for you?`, tools: ['web_search'], mostUsed: true, useCase: 'Marketers, Bloggers' },
  // Analytics
  { id: 'data-analyst', name: 'Data Analyst Agent', category: 'Analytics', description: 'Analyzes datasets, finds trends, writes SQL/Python.', icon: '📊', color: '#8b5cf6', gradient: 'from-violet-500 to-purple-600', systemPrompt: 'You are a Senior Data Analyst. Interpret data, suggest KPIs, write SQL queries.', greeting: `I'm your Data Analyst Agent. I can write SQL queries, interpret trends, and suggest KPIs. Share your data or describe what to analyze.`, tools: ['code_interpreter', 'file_reader'], mostUsed: false, useCase: 'Business Intelligence' },
  // Sales
  { id: 'sales-agent', name: 'Sales & Lead Generator', category: 'Sales', description: 'Qualifies leads, writes cold emails, builds scripts.', icon: '🤝', color: '#ef4444', gradient: 'from-rose-500 to-red-600', systemPrompt: 'You are a high-closing Sales Agent. Write persuasive outreach, handle objections, qualify leads.', greeting: `I'm your Sales & Lead Generator. I can write cold emails, handle objections, and qualify leads. Who are you trying to reach?`, tools: ['web_search', 'email_sender'], mostUsed: true, useCase: 'SDRs, Founders' },
  // Marketing
  { id: 'social-media-manager', name: 'Social Media Manager', category: 'Marketing', description: 'Plans calendars, writes captions, campaign ideas.', icon: '📱', color: '#ec4899', gradient: 'from-pink-500 to-rose-600', systemPrompt: 'You are a Social Media Strategist. Create content for Instagram, LinkedIn, TikTok, and X.', greeting: `I'm your Social Media Manager. I can plan content calendars, write captions, and design campaign ideas for Instagram, LinkedIn, TikTok, and X.`, tools: ['web_search'], mostUsed: true, useCase: 'Brands, Influencers' },
  { id: 'seo-specialist', name: 'SEO Specialist Agent', category: 'Marketing', description: 'Audits pages, suggests keywords, meta descriptions.', icon: '🔍', color: '#6366f1', gradient: 'from-indigo-500 to-violet-600', systemPrompt: 'You are an SEO Expert. Perform keyword research, suggest on-page optimizations.', greeting: `I'm your SEO Specialist. I can audit pages, suggest keywords, and write meta descriptions. Share a URL or topic.`, tools: ['web_search'], mostUsed: false, useCase: 'Website Owners' },
  // Legal
  { id: 'legal-reviewer', name: 'Legal Document Reviewer', category: 'Legal', description: 'Reviews contracts, flags risks, summarizes clauses.', icon: '⚖️', color: '#1e293b', gradient: 'from-slate-700 to-slate-900', systemPrompt: 'You are a Legal Assistant AI. Review contracts and NDAs. You are NOT a lawyer—suggest professional counsel.', greeting: `I can review contracts and flag risks. Please paste the clause. ⚠️ I am not an attorney—this is not legal advice.`, tools: ['file_reader'], mostUsed: false, useCase: 'Founders, Small Biz' },
  // Productivity
  { id: 'personal-assistant', name: 'Personal Productivity Assistant', category: 'Productivity', description: 'Manages schedules, prioritizes tasks, daily plans.', icon: '✅', color: '#06b6d4', gradient: 'from-cyan-400 to-blue-600', systemPrompt: 'You are a Personal Executive Assistant. Help prioritize tasks, draft emails, build routines.', greeting: `I'm your Personal Assistant. I can help prioritize tasks, draft emails, and build daily routines. What's your first priority?`, tools: [], mostUsed: true, useCase: 'Executives, Students' },
  // Communication
  { id: 'translator', name: 'Language Translator', category: 'Communication', description: 'Translates across 50+ languages preserving tone.', icon: '🌐', color: '#14b8a6', gradient: 'from-teal-400 to-green-600', systemPrompt: 'You are a professional multilingual translator. Preserve tone and cultural nuance.', greeting: `I can translate between 50+ languages preserving tone. Share the text and target language.`, tools: [], mostUsed: false, useCase: 'Global Teams' },
  // Research
  { id: 'research-agent', name: 'Market Research Agent', category: 'Research', description: 'Scrapes trends, compares competitors, summarizes reports.', icon: '🔎', color: '#f97316', gradient: 'from-orange-500 to-amber-600', systemPrompt: 'You are a Market Research Analyst. Analyze industries, compare competitors, summarize briefs.', greeting: `I'm your Market Research Agent. I can analyze industries, compare competitors, and summarize trends. Which market?`, tools: ['web_search'], mostUsed: false, useCase: 'Founders, PMs' },
  // HR
  { id: 'hr-recruiter', name: 'HR & Recruiting Agent', category: 'Human Resources', description: 'Screens resumes, writes job descriptions, interviews.', icon: '👥', color: '#a855f7', gradient: 'from-purple-500 to-fuchsia-600', systemPrompt: 'You are an HR Recruiter. Write inclusive job descriptions, screen candidates, prepare interviews.', greeting: `I'm your HR Recruiter. I can write job descriptions, screen resumes, and prepare interview questions. What role?`, tools: ['file_reader'], mostUsed: false, useCase: 'Hiring Managers' },

  // Business Management
  { id: 'ceo-assistant', name: 'CEO Executive Assistant', category: 'Business Management', description: 'Strategic planning, KPI tracking, board prep.', icon: '🏢', color: '#6366f1', gradient: 'from-indigo-500 to-purple-600', systemPrompt: 'You are a CEO Executive Assistant. Help with strategic planning, KPIs, board prep, executive decisions.', greeting: `I'm your CEO Executive Assistant. I can help with strategic planning, KPIs, board prep, and executive decisions. What's on your agenda?`, tools: [], mostUsed: true, useCase: 'Founders, Executives' },
  { id: 'operations-manager', name: 'Operations Manager', category: 'Business Management', description: 'SOPs, workflow optimization, vendor management.', icon: '⚙️', color: '#64748b', gradient: 'from-slate-500 to-gray-600', systemPrompt: 'You are an Operations Manager. Optimize workflows, write SOPs, manage vendors.', greeting: `I'm your Operations Manager. I can optimize workflows, write SOPs, and manage vendors. What process needs improvement?`, tools: [], mostUsed: false, useCase: 'COOs, Operations Teams' },
  { id: 'financial-controller', name: 'Financial Controller', category: 'Business Management', description: 'Budgeting, cash flow, expense tracking, invoicing.', icon: '💰', color: '#10b981', gradient: 'from-emerald-400 to-green-600', systemPrompt: 'You are a Financial Controller. Help with budgets, cash flow, expense tracking, invoicing.', greeting: `I'm your Financial Controller. I can help with budgeting, cash flow, and expense tracking. What financial goal are you working on?`, tools: [], mostUsed: true, useCase: 'CFOs, Finance Teams' },
  { id: 'project-manager', name: 'Project Manager', category: 'Business Management', description: 'Agile sprints, Gantt charts, risk management.', icon: '📋', color: '#3b82f6', gradient: 'from-blue-500 to-cyan-600', systemPrompt: 'You are a Project Manager. Plan sprints, create timelines, manage risks.', greeting: `I'm your Project Manager. I can plan agile sprints, create timelines, and manage risks. What project are we running?`, tools: [], mostUsed: true, useCase: 'Agencies, Tech Teams' },
  { id: 'supply-chain-agent', name: 'Supply Chain Agent', category: 'Business Management', description: 'Inventory, logistics, procurement, vendor relations.', icon: '🚚', color: '#94a3b8', gradient: 'from-slate-400 to-slate-600', systemPrompt: 'You are a Supply Chain Agent. Manage inventory, logistics, procurement, vendors.', greeting: `I'm your Supply Chain Agent. I can manage inventory, logistics, and vendor relations. What's your supply chain challenge?`, tools: [], mostUsed: false, useCase: 'E-commerce, Logistics' },
  { id: 'hr-manager', name: 'HR Manager', category: 'Business Management', description: 'Onboarding, performance reviews, payroll, employee relations.', icon: '👔', color: '#a855f7', gradient: 'from-purple-500 to-violet-600', systemPrompt: 'You are an HR Manager. Help with onboarding, reviews, payroll, employee relations.', greeting: `I'm your HR Manager. I can help with onboarding, performance reviews, and payroll questions. What do you need?`, tools: [], mostUsed: false, useCase: 'HR Teams, Startups' },

  // Law Firm Management
  { id: 'legal-researcher', name: 'Legal Research Assistant', category: 'Law Firm Management', description: 'Case law research, statute analysis, precedents.', icon: '📚', color: '#1e293b', gradient: 'from-slate-700 to-slate-900', systemPrompt: 'You are a Legal Research Assistant. Research case law, analyze statutes, find precedents.', greeting: `I'm your Legal Research Assistant. I can research case law, analyze statutes, and find precedents. What legal topic?`, tools: ['web_search'], mostUsed: true, useCase: 'Law Firms, Paralegals' },
  { id: 'contract-specialist', name: 'Contract Review Specialist', category: 'Law Firm Management', description: 'NDA, employment, vendor contract review.', icon: '📄', color: '#64748b', gradient: 'from-slate-500 to-gray-600', systemPrompt: 'You are a Contract Review Specialist. Review NDAs, employment agreements, vendor contracts. Flag risky clauses.', greeting: `I'm your Contract Review Specialist. I can review NDAs, employment agreements, and vendor contracts. Paste the contract text.`, tools: ['file_reader'], mostUsed: true, useCase: 'Legal Departments' },
  { id: 'paralegal-support', name: 'Paralegal Support', category: 'Law Firm Management', description: 'Discovery support, document organization, filing deadlines.', icon: '📂', color: '#94a3b8', gradient: 'from-slate-400 to-slate-600', systemPrompt: 'You are a Paralegal Support agent. Help with discovery, document organization, court deadlines.', greeting: `I'm your Paralegal Support agent. I can help with discovery, document organization, and filing deadlines.`, tools: ['file_reader'], mostUsed: false, useCase: 'Law Firms' },
  { id: 'compliance-officer', name: 'Compliance Officer', category: 'Law Firm Management', description: 'Regulatory compliance, GDPR, industry regulations.', icon: '🛡️', color: '#10b981', gradient: 'from-emerald-400 to-green-600', systemPrompt: 'You are a Compliance Officer. Ensure GDPR, regulatory compliance, data privacy.', greeting: `I'm your Compliance Officer. I can help with GDPR, regulatory compliance, and data privacy. What regulation?`, tools: [], mostUsed: false, useCase: 'Compliance Teams' },
  { id: 'litigation-support', name: 'Litigation Support', category: 'Law Firm Management', description: 'Deposition summaries, trial prep, exhibit organization.', icon: '🔨', color: '#ef4444', gradient: 'from-rose-500 to-red-600', systemPrompt: 'You are a Litigation Support agent. Summarize depositions, prepare trial exhibits, organize case materials.', greeting: `I'm your Litigation Support agent. I can summarize depositions, prepare trial exhibits, and organize case materials.`, tools: [], mostUsed: false, useCase: 'Litigators' },
  { id: 'client-intake', name: 'Client Intake Specialist', category: 'Law Firm Management', description: 'Lead qualification, conflict checks, consultation scheduling.', icon: '🤝', color: '#ec4899', gradient: 'from-pink-500 to-rose-600', systemPrompt: 'You are a Client Intake Specialist. Qualify legal leads, run conflict checks, schedule consultations.', greeting: `I'm your Client Intake Specialist. I can qualify legal leads, run conflict checks, and schedule consultations.`, tools: [], mostUsed: true, useCase: 'Law Firms' },

  // Personal Tools
  { id: 'finance-advisor', name: 'Personal Finance Advisor', category: 'Personal Tools', description: 'Budgeting, investment basics, debt payoff.', icon: '💸', color: '#10b981', gradient: 'from-emerald-400 to-green-600', systemPrompt: 'You are a Personal Finance Advisor. Help with budgeting, investments, debt payoff.', greeting: `I'm your Personal Finance Advisor. I can help with budgeting, investments, and debt payoff. What's your financial goal?`, tools: [], mostUsed: true, useCase: 'Individuals' },
  { id: 'fitness-coach', name: 'Fitness & Nutrition Coach', category: 'Personal Tools', description: 'Workout plans, meal prep, macro tracking.', icon: '💪', color: '#ec4899', gradient: 'from-pink-500 to-rose-600', systemPrompt: 'You are a Fitness & Nutrition Coach. Create workout plans, meal prep, track macros.', greeting: `I'm your Fitness & Nutrition Coach. I can create workout plans, meal prep ideas, and track macros. What's your fitness goal?`, tools: [], mostUsed: true, useCase: 'Health Enthusiasts' },
  { id: 'travel-planner', name: 'Travel Planner', category: 'Personal Tools', description: 'Itinerary planning, flights, hotels, local recommendations.', icon: '✈️', color: '#06b6d4', gradient: 'from-cyan-400 to-blue-600', systemPrompt: 'You are a Travel Planner. Create itineraries, suggest flights/hotels, recommend attractions.', greeting: `I'm your Travel Planner. I can create itineraries, suggest flights/hotels, and recommend attractions. Where are you going?`, tools: ['web_search'], mostUsed: false, useCase: 'Travelers' },
  { id: 'home-manager', name: 'Home Maintenance Manager', category: 'Personal Tools', description: 'Repair scheduling, vendor quotes, seasonal checklists.', icon: '🏠', color: '#f59e0b', gradient: 'from-amber-400 to-orange-600', systemPrompt: 'You are a Home Maintenance Manager. Schedule repairs, get vendor quotes, manage checklists.', greeting: `I'm your Home Maintenance Manager. I can schedule repairs, get vendor quotes, and manage seasonal checklists.`, tools: [], mostUsed: false, useCase: 'Homeowners' },
  { id: 'wedding-planner', name: 'Wedding Planner', category: 'Personal Tools', description: 'Venue selection, vendor coordination, budget tracking.', icon: '💍', color: '#d946ef', gradient: 'from-fuchsia-500 to-purple-600', systemPrompt: 'You are a Wedding Planner. Help with venues, vendors, budgets, timelines.', greeting: `I'm your Wedding Planner. I can help with venues, vendors, budgets, and timelines. When is the big day?`, tools: [], mostUsed: false, useCase: 'Couples' },
  { id: 'event-planner', name: 'Event Planner', category: 'Personal Tools', description: 'Parties, corporate events, guest lists, catering.', icon: '🎉', color: '#f97316', gradient: 'from-orange-500 to-amber-600', systemPrompt: 'You are an Event Planner. Organize parties, corporate events, guest lists, catering.', greeting: `I'm your Event Planner. I can organize parties, corporate events, guest lists, and catering. What event?`, tools: [], mostUsed: false, useCase: 'Event Planners' },

  // Social Media
  { id: 'instagram-strategist', name: 'Instagram Strategist', category: 'Social Media', description: 'Reels strategy, hashtags, aesthetic planning, growth.', icon: '📸', color: '#ec4899', gradient: 'from-pink-500 to-rose-600', systemPrompt: 'You are an Instagram Strategist. Plan Reels, research hashtags, design aesthetic feeds.', greeting: `I'm your Instagram Strategist. I can plan Reels strategy, research hashtags, and design aesthetic feeds. What's your handle?`, tools: ['web_search'], mostUsed: true, useCase: 'Creators, Brands' },
  { id: 'tiktok-growth', name: 'TikTok Growth Agent', category: 'Social Media', description: 'Viral scripts, trend identification, posting schedule.', icon: '🎵', color: '#000000', gradient: 'from-gray-800 to-gray-900', systemPrompt: 'You are a TikTok Growth Agent. Write viral scripts, identify trends, create posting schedules.', greeting: `I'm your TikTok Growth Agent. I can write viral scripts, identify trends, and create posting schedules. What's your niche?`, tools: ['web_search'], mostUsed: true, useCase: 'Content Creators' },
  { id: 'linkedin-leader', name: 'LinkedIn Thought Leader', category: 'Social Media', description: 'Personal branding, post writing, networking scripts.', icon: '💼', color: '#0a66c2', gradient: 'from-blue-600 to-indigo-600', systemPrompt: 'You are a LinkedIn Thought Leader. Build personal brands, write posts, networking scripts.', greeting: `I'm your LinkedIn Thought Leader. I can build your personal brand, write posts, and create networking scripts.`, tools: [], mostUsed: true, useCase: 'Professionals' },
  { id: 'youtube-strategist', name: 'YouTube Content Strategist', category: 'Social Media', description: 'Video ideas, script outlines, thumbnail concepts, SEO.', icon: '▶️', color: '#ff0000', gradient: 'from-red-600 to-rose-600', systemPrompt: 'You are a YouTube Content Strategist. Generate video ideas, script outlines, thumbnail concepts.', greeting: `I'm your YouTube Content Strategist. I can generate video ideas, write script outlines, and design thumbnail concepts.`, tools: ['web_search'], mostUsed: false, useCase: 'YouTubers' },
  { id: 'twitter-growth', name: 'Twitter/X Growth Agent', category: 'Social Media', description: 'Thread writing, engagement strategies, follower growth.', icon: '🐦', color: '#000000', gradient: 'from-gray-800 to-gray-900', systemPrompt: 'You are a Twitter/X Growth Agent. Write threads, engagement strategies, grow followers.', greeting: `I'm your Twitter/X Growth Agent. I can write threads, create engagement strategies, and grow followers.`, tools: [], mostUsed: false, useCase: 'Social Media Managers' },
  { id: 'pinterest-manager', name: 'Pinterest Manager', category: 'Social Media', description: 'Pin design ideas, board strategy, traffic generation.', icon: '📌', color: '#e60023', gradient: 'from-red-600 to-pink-600', systemPrompt: 'You are a Pinterest Manager. Design pin ideas, create board strategies, generate traffic.', greeting: `I'm your Pinterest Manager. I can design pin ideas, create board strategies, and generate traffic.`, tools: [], mostUsed: false, useCase: 'Bloggers, E-commerce' },

  // Daily Life
  { id: 'meal-planner', name: 'Meal Planner & Grocery List', category: 'Daily Life', description: 'Dietary preferences, budget meals, shopping lists.', icon: '🍽️', color: '#f97316', gradient: 'from-orange-500 to-amber-600', systemPrompt: 'You are a Meal Planner. Create meal plans based on diet and budget, with grocery lists.', greeting: `I'm your Meal Planner. I can create meal plans based on your diet and budget, with grocery lists. What do you like to eat?`, tools: [], mostUsed: true, useCase: 'Families, Individuals' },
  { id: 'gift-finder', name: 'Gift Finder', category: 'Daily Life', description: 'Occasion-based recommendations, budget, delivery.', icon: '🎁', color: '#d946ef', gradient: 'from-fuchsia-500 to-purple-600', systemPrompt: 'You are a Gift Finder. Suggest gifts based on occasion, recipient, budget.', greeting: `I'm your Gift Finder. I can suggest gifts based on occasion, recipient, and budget. Who are you shopping for?`, tools: ['web_search'], mostUsed: false, useCase: 'Shoppers' },
  { id: 'subscription-manager', name: 'Subscription Manager', category: 'Daily Life', description: 'Renewal tracking, cancellation help, cost analysis.', icon: '📱', color: '#64748b', gradient: 'from-slate-500 to-gray-600', systemPrompt: 'You are a Subscription Manager. Track renewals, help cancel services, analyze costs.', greeting: `I'm your Subscription Manager. I can track renewals, help cancel services, and analyze costs.`, tools: [], mostUsed: false, useCase: 'Consumers' },
  { id: 'habit-coach', name: 'Habit Tracker Coach', category: 'Daily Life', description: 'Habit stacking, motivation, progress tracking.', icon: '🌱', color: '#10b981', gradient: 'from-emerald-400 to-green-600', systemPrompt: 'You are a Habit Tracker Coach. Help build habits with stacking, motivation, tracking.', greeting: `I'm your Habit Tracker Coach. I can help build habits with stacking techniques and progress tracking. What habit?`, tools: [], mostUsed: false, useCase: 'Self-Improvement' },
  { id: 'language-partner', name: 'Language Learning Partner', category: 'Daily Life', description: 'Conversation practice, grammar, vocabulary.', icon: '🗣️', color: '#6366f1', gradient: 'from-indigo-500 to-violet-600', systemPrompt: 'You are a Language Learning Partner. Practice conversations, explain grammar, build vocabulary.', greeting: `I'm your Language Learning Partner. I can practice conversations, explain grammar, and build vocabulary. Which language?`, tools: [], mostUsed: false, useCase: 'Learners' },
  { id: 'meditation-guide', name: 'Meditation & Mindfulness Guide', category: 'Daily Life', description: 'Stress relief, sleep aid, breathing exercises.', icon: '🧘', color: '#14b8a6', gradient: 'from-teal-400 to-green-600', systemPrompt: 'You are a Meditation Guide. Provide stress relief, sleep aid, breathing exercises.', greeting: `I'm your Meditation Guide. I can provide stress relief, sleep aid, and breathing exercises. How are you feeling?`, tools: [], mostUsed: false, useCase: 'Wellness' }
];

// What the browser gets: everything except the server-side prompt and greeting text.
const publicAgent = ({ systemPrompt, greeting, ...rest }) => rest;
const PUBLIC_AGENTS = AGENTS.map(publicAgent);

// ============================
//  TOOLS (Simulated)
// ============================

// Small arithmetic evaluator (+ - * / parentheses, unary minus). No eval().
function safeCalc(expr) {
  const s = String(expr).replace(/\s+/g, '');
  if (!s || s.length > 200 || !/^[0-9+\-*/().]+$/.test(s)) throw new Error('Invalid expression');
  let i = 0;
  const parseAtom = () => {
    const c = s[i];
    if (c === '(') {
      i++;
      const v = parseSum();
      if (s[i] !== ')') throw new Error('Unbalanced parentheses');
      i++;
      return v;
    }
    if (c === '-') { i++; return -parseAtom(); }
    if (c === '+') { i++; return parseAtom(); }
    const m = /^(\d+(\.\d+)?|\.\d+)/.exec(s.slice(i));
    if (!m) throw new Error('Unexpected token');
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const parseProduct = () => {
    let v = parseAtom();
    while (s[i] === '*' || s[i] === '/') {
      const op = s[i++];
      const r = parseAtom();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const parseSum = () => {
    let v = parseProduct();
    while (s[i] === '+' || s[i] === '-') {
      const op = s[i++];
      const r = parseProduct();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const result = parseSum();
  if (i !== s.length || !Number.isFinite(result)) throw new Error('Invalid expression');
  return result;
}

function executeTool(toolName, input) {
  input = String(input ?? '').slice(0, 500);
  switch (toolName) {
    case 'web_search': return `[Mock Search Results for "${input}"]:\n1. Example.com - Detailed guide...\n2. IndustryReport.pdf - 2024 Trends...\n(Connect a real search API for live data.)`;
    case 'calculator': try { return `Result: ${safeCalc(input)}`; } catch { return 'Invalid math expression.'; }
    case 'code_interpreter': return `[Code Execution Output]\n${input}\n\n✅ Execution successful (simulated).`;
    case 'file_reader': return `[File Content]\n---\n${input}\n---\n(Simulated file read.)`;
    case 'ticket_system': return `Ticket #${Math.floor(Math.random() * 10000)} created. Status: Open.`;
    case 'email_sender': return `Email queued to ${input}. Status: Sent (simulated).`;
    case 'knowledge_base': return `Knowledge Base Match: "Our return policy is 30 days. Refunds processed within 5-7 business days."`;
    default: return `Tool ${toolName} executed with input: ${input}`;
  }
}

// ============================
//  DEMO RESPONSE BUILDER
// ============================
function buildDemoResponse(agent, userMsg) {
  const lower = userMsg.toLowerCase();
  const text = userMsg.trim();
  let toolUsed = null, toolOutput = '';

  if (agent.tools.includes('knowledge_base') && (lower.includes('refund') || lower.includes('policy'))) { toolUsed = 'knowledge_base'; toolOutput = executeTool('knowledge_base', text); }
  else if (agent.tools.includes('ticket_system') && (lower.includes('ticket') || lower.includes('issue'))) { toolUsed = 'ticket_system'; toolOutput = executeTool('ticket_system', text); }
  else if (agent.tools.includes('code_interpreter') && (lower.includes('code') || lower.includes('script'))) { toolUsed = 'code_interpreter'; toolOutput = executeTool('code_interpreter', `// ${text}\nconsole.log("AgentVerse output");`); }
  else if (agent.tools.includes('web_search') && (lower.includes('search') || lower.includes('trend'))) { toolUsed = 'web_search'; toolOutput = executeTool('web_search', text); }
  else if (agent.tools.includes('email_sender') && lower.includes('email')) { toolUsed = 'email_sender'; toolOutput = executeTool('email_sender', 'contact@example.com'); }

  let response = agent.greeting || `Hello! I'm your ${agent.name}. ${agent.description}`;
  if (toolUsed) response += `\n\n🔧 Tool used: \`${toolUsed}\`\n\`\`\`\n${toolOutput}\n\`\`\``;
  response += `\n\n_Demo mode — replies are canned. Set \`GEMINI_API_KEY\` or \`OPENAI_API_KEY\` on the server for real answers._`;
  return response;
}

// ============================
//  LLM STREAMING (Demo + OpenAI + Gemini)
// ============================
async function* streamOpenAI(agent, messages, signal) {
  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      stream: true,
      messages: [{ role: 'system', content: agent.systemPrompt }, ...messages]
    })
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI responded ${res.status} ${detail.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep any partial line for the next chunk
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const token = JSON.parse(data).choices?.[0]?.delta?.content;
        if (token) yield token;
      } catch { /* ignore malformed keep-alive lines */ }
    }
  }
}

// Gemini wants roles 'user' / 'model', starting with 'user'. Merge neighbours that share a role
// and drop any leading model turns (history is capped, so it can start mid-conversation).
function toGeminiContents(messages) {
  const contents = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += `\n\n${m.content}`;
    else contents.push({ role, parts: [{ text: m.content }] });
  }
  while (contents.length && contents[0].role !== 'user') contents.shift();
  return contents;
}

const sleep = (ms, signal) => new Promise(resolve => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

// Opens a streaming Gemini response. This only ever happens before any text is sent to the
// user, so retrying and switching models is invisible to them. Rules:
//   temporary errors (429, 5xx, network)  -> retry the same model once, then try the next model
//   404 (model not available to this key) -> try the next model straight away
//   anything else (400, 401, 403, ...)    -> give up now; retrying or switching cannot help
async function openGeminiStream(agent, messages, signal) {
  // The key goes in a header (never the URL) so it can't leak into request logs.
  const headers = { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' };
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: agent.systemPrompt }] },
    contents: toGeminiContents(messages)
  });
  const startedAt = Date.now();
  let lastError = null;

  for (const model of GEMINI_MODELS) {
    for (let attempt = 1; attempt <= GEMINI_ATTEMPTS_PER_MODEL; attempt++) {
      if (signal?.aborted) throw new Error('aborted');
      if (Date.now() - startedAt > GEMINI_DEADLINE_MS) throw lastError || new Error('Gemini: out of time');

      let res;
      try {
        res = await fetch(`${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, { method: 'POST', signal, headers, body });
      } catch (err) {
        if (signal?.aborted) throw err;
        lastError = new Error(`Gemini (${model}) network error: ${err.message}`);
        console.warn(`gemini ${model} attempt ${attempt}/${GEMINI_ATTEMPTS_PER_MODEL}: network error ${err.message}`);
        if (attempt < GEMINI_ATTEMPTS_PER_MODEL) await sleep(GEMINI_RETRY_DELAY_MS, signal);
        continue;
      }

      if (res.ok && res.body) {
        if (model !== GEMINI_MODEL) console.warn(`gemini: ${GEMINI_MODEL} unavailable, answered by backup model ${model}`);
        return res;
      }

      const detail = await res.text().catch(() => '');
      lastError = new Error(`Gemini (${model}) responded ${res.status} ${detail.slice(0, 200)}`);
      console.warn(`gemini ${model} attempt ${attempt}/${GEMINI_ATTEMPTS_PER_MODEL}: HTTP ${res.status}`);
      if (GEMINI_RETRY_STATUSES.has(res.status)) {
        if (attempt < GEMINI_ATTEMPTS_PER_MODEL) await sleep(GEMINI_RETRY_DELAY_MS, signal);
        continue;
      }
      if (res.status === 404) break; // unknown model name: move on to the next one
      throw lastError;               // key / request problems are the same for every model
    }
  }
  throw lastError || new Error('Gemini unavailable');
}

async function* streamGemini(agent, messages, signal) {
  const res = await openGeminiStream(agent, messages, signal);

  let yielded = false;
  let blockReason = null;
  function* handleLines(lines) {
    for (const raw of lines) {
      const line = raw.replace(/\r$/, ''); // Gemini's SSE uses CRLF
      if (!line.startsWith('data:')) continue;
      let chunk;
      try { chunk = JSON.parse(line.slice(5).trim()); } catch { continue; } // ignore malformed lines
      if (chunk.error) throw new Error(`Gemini error: ${String(chunk.error.message || '').slice(0, 200)}`);
      if (chunk.promptFeedback?.blockReason) blockReason = chunk.promptFeedback.blockReason;
      const text = (chunk.candidates?.[0]?.content?.parts || [])
        .filter(p => !p.thought) // never show the model's internal reasoning
        .map(p => p.text || '')
        .join('');
      if (text) { yielded = true; yield text; }
    }
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep any partial line for the next chunk
    yield* handleLines(lines);
  }
  yield* handleLines([buffer]); // a final line may arrive without a trailing newline
  if (!yielded) throw new Error(blockReason ? `Gemini blocked the prompt (${blockReason})` : 'Gemini returned no text');
}

const STREAMERS = { openai: streamOpenAI, gemini: streamGemini };

async function* callLLM(agent, messages, signal) {
  const stream = STREAMERS[PROVIDER];
  if (stream) {
    let started = false;
    try {
      const history = messages.map(({ role, content }) => ({ role, content }));
      for await (const token of stream(agent, history, signal)) {
        started = true;
        yield token;
      }
      return;
    } catch (err) {
      if (signal?.aborted) return;
      console.error(`${PROVIDER} error:`, err.message);
      if (started) throw err; // can't cleanly switch to demo mid-reply
      // nothing sent yet -> fall through to demo reply
    }
  }

  const last = messages[messages.length - 1]?.content || '';
  const words = buildDemoResponse(agent, last).split(' ');
  for (let i = 0; i < words.length; i++) {
    if (signal?.aborted) return;
    yield words[i] + (i < words.length - 1 ? ' ' : '');
    await new Promise(r => setTimeout(r, 20 + Math.random() * 30));
  }
}

// ============================
//  RATE LIMIT (in memory, per instance)
// ============================
// Best-effort only: on serverless hosts each instance has its own counter, so use the
// host's firewall / rate limiting (and an OpenAI spending cap) for hard limits.
const hitsByIp = new Map(); // ip -> [timestamps]

const cleanup = setInterval(() => {
  for (const [ip, hits] of hitsByIp) {
    if (!hits.length || hits[hits.length - 1] < Date.now() - RATE_LIMIT.windowMs) hitsByIp.delete(ip);
  }
}, 10 * 60 * 1000);
cleanup.unref();

function rateLimit(req, res, next) {
  const now = Date.now();
  const hits = (hitsByIp.get(req.ip) || []).filter(t => t > now - RATE_LIMIT.windowMs);
  if (hits.length >= RATE_LIMIT.max) {
    res.set('Retry-After', String(Math.ceil(RATE_LIMIT.windowMs / 1000)));
    return res.status(429).json({ error: 'Too many requests — please wait a minute.' });
  }
  hits.push(now);
  hitsByIp.set(req.ip, hits);
  next();
}

// ============================
//  ROUTES
// ============================
app.get('/healthz', (req, res) => res.type('text').send('ok'));
app.get('/api/health', (req, res) => res.json({ ok: true, mode: PROVIDER === 'demo' ? 'demo' : 'live', provider: PROVIDER, agents: AGENTS.length }));

app.get('/api/agents', (req, res) => res.json(PUBLIC_AGENTS));
app.get('/api/agents/:id', (req, res) => {
  const agent = PUBLIC_AGENTS.find(a => a.id === req.params.id);
  if (!agent) return res.status(404).json({ error: 'Not found' });
  res.json(agent);
});

// Chat is stateless: the browser keeps the conversation and sends the recent turns with
// each request, so any server instance (e.g. Vercel serverless) can answer any request.
// Returns a cleaned [{ role, content }] array, or null if the input is malformed.
function parseHistory(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const history = [];
  for (const m of raw.slice(-MAX_HISTORY_MESSAGES)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') return null;
    if (!m.content.trim()) continue; // empty turns would make the model API reject the request
    history.push({ role: m.role, content: m.content.slice(0, MAX_HISTORY_CHARS) });
  }
  return history;
}

app.post('/api/chat', rateLimit, async (req, res) => {
  const body = req.body || {};
  const { agentId, message } = body;
  if (typeof agentId !== 'string' || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Missing or invalid fields' });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_CHARS} characters)` });
  }
  const history = parseHistory(body.history);
  if (!history) return res.status(400).json({ error: 'Invalid history' });
  const agent = AGENTS.find(a => a.id === agentId);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const messages = [...history, { role: 'user', content: message }];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // stop nginx-style proxies from buffering the stream
  res.flushHeaders();

  const send = payload => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  // Stop work if the browser goes away mid-stream.
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableEnded) abort.abort(); });

  let aiContent = '';
  try {
    for await (const chunk of callLLM(agent, messages, abort.signal)) {
      aiContent += chunk;
      send({ type: 'stream', content: chunk });
    }
  } catch (err) {
    console.error('Chat error:', err.message);
    send({ type: 'error', content: 'The AI service had a problem. Please try again.' });
  }

  if (abort.signal.aborted) return;

  send({ type: 'done', message: aiContent ? { role: 'assistant', content: aiContent } : null });
  res.end();
});

const TOOL_NAMES = new Set(['web_search', 'calculator', 'code_interpreter', 'file_reader', 'ticket_system', 'email_sender', 'knowledge_base']);
app.post('/api/tools/execute', (req, res) => {
  const { tool, input } = req.body || {};
  if (typeof tool !== 'string' || !TOOL_NAMES.has(tool)) return res.status(400).json({ error: 'Unknown tool' });
  res.json({ result: executeTool(tool, input) });
});

// Run as a normal server (local, Docker, Render, Railway). When another runtime
// imports this file instead (Vercel serverless), it only needs the exported app.
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`🚀 AgentVerse website running at http://localhost:${PORT}`);
    console.log(`🤖 Mode: ${PROVIDER === 'demo' ? 'DEMO (instant, no API key needed)' : `REAL AI (${PROVIDER}, ${PROVIDER === 'gemini' ? GEMINI_MODELS.join(' -> ') : PROVIDER_MODEL})`}`);
  });

  // Let hosts (Render, Railway, Docker) stop the container cleanly.
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => server.close(() => process.exit(0)));
  }
}

module.exports = app;
