export interface TopSpot {
	name: string;
	type: string;
	rating: number;
}

export interface Review {
	user: string;
	text: string;
	rating: number;
}

export interface City {
	city: string;
	state: string;
	avgHotelPerNight: number;
	avgFoodPerDay: number;
	petrolPerKm: number;
	topSpots: TopSpot[];
	reviews: Review[];
}
