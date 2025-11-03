import fs from "fs";
import path from "path";
import { City, CostEstimate, CostParams } from "./types/index.js";

/**
 * Loads and parses the travelData.json file.
 */
export function loadTravelData(dbPath: string): City[] {
	try {
		const data = fs.readFileSync(path.resolve(dbPath), "utf8");
		const db: { cities: City[] } = JSON.parse(data);
		return db.cities || [];
	} catch (error) {
		console.error("Failed to load or parse travelData.json:", error);
		return [];
	}
}

/**
 * Estimates the cost of a trip based on provided parameters.
 */
export function estimateTripCost(params: CostParams): CostEstimate {
	const { distanceKm, nights, hotelPerNight, foodPerDay, petrolPerKm } =
		params;

	const fuelCost = Math.round(distanceKm * petrolPerKm);
	const hotel = nights * hotelPerNight;
	const food = nights * foodPerDay;
	const fun = nights * 1000; // Fixed "fun" budget
	const total = fuelCost + hotel + food + fun;

	return { fuelCost, hotel, food, fun, total };
}

/**
 * Searches the list of cities for a query match.
 */
export function searchCity(query: string, cities: City[]): City[] {
	const q = query.toLowerCase();

	// Direct match in city or state
	let hits = cities.filter(
		(c) =>
			q.includes(c.city.toLowerCase()) ||
			q.includes(c.state.toLowerCase())
	);
	if (hits.length) return hits;

	// Word-by-word match in city
	const words = q.split(/\W+/);
	return cities.filter((c) =>
		words.some((word) => c.city.toLowerCase() === word)
	);
}
