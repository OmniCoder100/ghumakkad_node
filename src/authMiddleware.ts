import { Request, Response, NextFunction } from "express";
import { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Factory function to create the authentication middleware.
 * We pass in the Supabase client to avoid circular dependencies.
 * @param supabase The initialized Supabase client.
 * @returns The Express middleware function.
 */
export const createAuthMiddleware = (supabase: SupabaseClient) => {
	return async (req: Request, res: Response, next: NextFunction) => {
		// 1. Get the token from the Authorization header
		const authHeader = req.headers.authorization;
		if (!authHeader) {
			return res.status(401).json({ error: "No authorization header." });
		}

		const token = authHeader.split(" ")[1]; // "Bearer <token>"
		if (!token) {
			return res.status(401).json({ error: "Malformed authorization header." });
		}

		try {
			// 2. Verify the token with Supabase
			const { data, error } = await supabase.auth.getUser(token);

			if (error || !data.user) {
				console.error("Auth error:", error?.message);
				return res.status(401).json({ error: "Invalid token." });
			}

			// 3. Attach user to request and continue
			req.user = data.user;
			next();
		} catch (error: any) {
			console.error("Critical auth error:", error.message);
			res.status(500).json({ error: "Internal authentication error." });
		}
	};
};