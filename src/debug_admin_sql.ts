// This is a new debug script that uses the ADMIN (service_role) key
// to bypass all RLS and security.
import dotenv from "dotenv";
import { GoogleGenerativeAI, TaskType } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";

const TEST_QUERY = "Can you give me a 2-day plan for Jaipur?";

const runTest = async () => {
	try {
		// 1. Load env vars
		dotenv.config();
		const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY as string;
		const SUPABASE_URL = process.env.SUPABASE_URL as string;

		// --- THIS IS THE CHANGE ---
		// We are using the admin SERVICE key, not the public ANON key
		const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY as string;
		// ---

		const RAG_QUERY_NAME = "match_documents";

		if (!GOOGLE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
			throw new Error("Missing environment variables (need SERVICE_KEY)");
		}

		// 2. Initialize clients
		// --- THIS IS THE CHANGE ---
		// Create the client with the SERVICE_KEY
		const supabaseClient = createClient(
			SUPABASE_URL,
			SUPABASE_SERVICE_KEY,
			{
				auth: {
					persistSession: false,
					autoRefreshToken: false,
				},
			}
		);
		// ---

		const geminiEmbedder = new GoogleGenerativeAIEmbeddings({
			apiKey: GOOGLE_API_KEY,
			model: "embedding-001",
			taskType: TaskType.SEMANTIC_SIMILARITY, // Using the type we ingested with
		});

		// 3. Generate the query vector
		console.log(`Generating vector for: "${TEST_QUERY}"...`);
		const queryVector = await geminiEmbedder.embedQuery(TEST_QUERY);
		console.log(`Vector generated (dimensions: ${queryVector.length})`);

		// 4. Format for RPC
		const queryVectorString = JSON.stringify(queryVector);

		// 5. Call the RPC
		console.log("Calling 'match_documents' RPC (as ADMIN)...");
		const { data, error } = await supabaseClient.rpc(RAG_QUERY_NAME, {
			query_embedding: queryVectorString, // Send the string
			match_count: 3,
			filter: "{}",
		});

		if (error) {
			throw new Error(`Supabase RPC error: ${error.message}`);
		}

		// 6. Log results
		console.log("\n--- ADMIN QUERY RESULTS ---");
		if (data && data.length > 0) {
			console.log(`✅ SUCCESS! Found ${data.length} matching documents:`);
			data.forEach((doc: any, i: number) => {
				console.log(
					`\n--- Match ${i + 1} (Similarity: ${doc.similarity}) ---`
				);
				console.log(doc.content.substring(0, 150) + "...");
				console.log(`Source: ${doc.metadata.source}`);
			});
		} else {
			console.log("❌ FAILURE: No documents found (even as admin).");
		}
	} catch (err: any) {
		console.error("\n🔥 ADMIN DEBUG SCRIPT FAILED 🔥");
		console.error(err.message);
	}
};

runTest();
