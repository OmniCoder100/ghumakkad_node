import { SupabaseUser } from "./index";

// Augment the Express.Request type
declare global {
	namespace Express {
		export interface Request {
			user?: SupabaseUser;
		}
	}
}
