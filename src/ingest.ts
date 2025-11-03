import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai"; // <-- Use LangChain
import { TaskType } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { Document } from "@langchain/core/documents";

// Load environment variables
dotenv.config();

// --- 1. CONFIGURATION ---
const KNOWLEDGE_DIR = "./knowledge_base";
const RAG_TABLE_NAME = "documents";

// --- 2. LOAD ENV KEYS ---
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY as string;
const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY as string;

if (!GOOGLE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
	throw new Error(
		"Missing required environment variables (GOOGLE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY)"
	);
}

// --- 3. INITIALIZE CLIENTS ---

// Initialize Supabase client (using the SERVICE key for admin access)
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
	auth: {
		persistSession: false,
		autoRefreshToken: false,
	},
});

// --- THIS IS THE FIX ---
// Initialize the *LangChain* Embedder, just like in server.ts
// We use RETRIEVAL_DOCUMENT here, which is correct for ingestion.
const geminiEmbedder = new GoogleGenerativeAIEmbeddings({
	apiKey: GOOGLE_API_KEY,
	model: "embedding-001",
	taskType: TaskType.SEMANTIC_SIMILARITY,
});
// --- END FIX ---

// --- 4. INGESTION FUNCTION ---
async function ingestData() {
	try {
		console.log("Starting ingestion...");

		// 1. Clear old documents from the table
		console.log(`Deleting old documents from '${RAG_TABLE_NAME}' table...`);
		const { error: deleteError } = await supabaseClient
			.from(RAG_TABLE_NAME)
			.delete()
			.neq("id", 0); // Deletes all rows
		if (deleteError)
			throw new Error(`Supabase delete error: ${deleteError.message}`);
		console.log("Old documents cleared.");

		// 2. Read files and create chunks
		console.log(`Reading files from ${KNOWLEDGE_DIR}...`);
		const files = await fs.readdir(KNOWLEDGE_DIR);
		const txtFiles = files.filter((f) => f.endsWith(".txt"));
		console.log(`Found ${txtFiles.length} knowledge files.`);

		let allDocs: Document[] = [];
		for (const file of txtFiles) {
			const content = await fs.readFile(
				path.join(KNOWLEDGE_DIR, file),
				"utf8"
			);
			allDocs.push(
				new Document({
					pageContent: content,
					metadata: { source: file },
				})
			);
		}

		const textSplitter = new RecursiveCharacterTextSplitter({
			chunkSize: 450,
			chunkOverlap: 50,
		});
		const allChunks = await textSplitter.splitDocuments(allDocs);

		const MIN_CHUNK_LENGTH = 15;
		const validChunks = allChunks.filter(
			(chunk) => chunk.pageContent.trim().length > MIN_CHUNK_LENGTH
		);
		console.log(
			`Created ${validChunks.length} valid document chunks (min ${MIN_CHUNK_LENGTH} chars).`
		);

		if (validChunks.length === 0) {
			console.warn("No valid chunks found. Ingestion skipped.");
			return;
		}

		// 3. --- Manually Embed Documents (using LangChain) ---
		console.log("Embedding chunks using LangChain/GoogleGenAI...");

		const chunkTexts = validChunks.map((chunk) => chunk.pageContent);
		const embeddings = await geminiEmbedder.embedDocuments(chunkTexts);

		// Validate the embeddings
		if (!embeddings || embeddings.length !== validChunks.length) {
			throw new Error(
				"Embedding API returned a different number of embeddings than expected."
			);
		}
		console.log(`Successfully generated ${embeddings.length} embeddings.`);

		// 4. --- Manually Insert into Supabase ---
		console.log("Preparing data for Supabase insert...");

		const rowsToInsert = validChunks
			.map((chunk, i) => {
				const embedding = embeddings[i];
				if (!embedding || embedding.length === 0) {
					console.warn(
						`Warning: Got an empty embedding for chunk from ${chunk.metadata.source}. Skipping.`
					);
					return null;
				}
				return {
					content: chunk.pageContent,
					metadata: chunk.metadata,
					embedding: embedding, // LangChain embedders return number[]
				};
			})
			.filter((row) => row !== null);

		if (rowsToInsert.length === 0) {
			throw new Error(
				"No valid embeddings were generated. Check source files."
			);
		}

		console.log(
			`Inserting ${rowsToInsert.length} valid vectors into Supabase...`
		);

		const BATCH_SIZE = 100;
		for (let i = 0; i < rowsToInsert.length; i += BATCH_SIZE) {
			const batch = rowsToInsert.slice(i, i + BATCH_SIZE);
			const { error: insertError } = await supabaseClient
				.from(RAG_TABLE_NAME)
				.insert(batch);

			if (insertError) {
				throw new Error(
					`Supabase insert error: ${insertError.message}`
				);
			}
			console.log(
				`Inserted batch ${i / BATCH_SIZE + 1} of ${Math.ceil(
					rowsToInsert.length / BATCH_SIZE
				)}`
			);
		}

		console.log("✅ Ingestion complete!");
	} catch (err: any) {
		console.error("Ingestion failed:", err.message);
		if (err.cause) {
			console.error("Cause:", err.cause);
		}
		process.exit(1);
	}
}

// Run the ingestion
ingestData();
