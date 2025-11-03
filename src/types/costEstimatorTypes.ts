export interface CostParams {
	distanceKm: number;
	nights: number;
	hotelPerNight: number;
	foodPerDay: number;
	petrolPerKm: number;
}

export interface CostEstimate {
	fuelCost: number;
	hotel: number;
	food: number;
	fun: number;
	total: number;
}
