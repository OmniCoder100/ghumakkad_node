import { User } from "@supabase/supabase-js";
import { SupabaseUser } from "./index";

// Augment the Express.Request type
declare global {
	namespace Express {
		export interface Request {
			user?: User;
		}
	}
}
