# ---- Stage 1: Build ----
# Use an official Node.js image as the base for building the app
FROM node:20-slim AS build

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and lockfile
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies for building)
RUN npm install

# Copy tsconfig and the source code
COPY tsconfig.json .
COPY src ./src

# Run the build script (compiles TS to JS in /dist)
RUN npm run build

# ---- Stage 2: Production ----
# Start from a fresh, slim Node.js image
FROM node:20-slim AS production

WORKDIR /usr/src/app

# Copy package.json and lockfile
COPY package.json package-lock.json* ./

# Install *only* production dependencies
RUN npm install --omit=dev

# Copy the compiled code from the 'build' stage
COPY --from=build /usr/src/app/dist ./dist

# Copy the travelData.json file, which is needed at runtime
COPY travelData.json .

# Set the port Cloud Run expects
ENV PORT=8080
EXPOSE 8080

# The command to start the server
CMD [ "npm", "run", "start" ]