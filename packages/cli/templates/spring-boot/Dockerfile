# Build stage
# Use JDK 21 as you requested
FROM gradle:8.5-jdk21 AS build
WORKDIR /app

# 1. Copy the wrapper files first
# These are essential for the ./gradlew command to work
COPY gradlew .
COPY gradle ./gradle
COPY build.gradle.kts settings.gradle.kts ./

# 2. Grant execution permissions to the wrapper
RUN chmod +x gradlew

# 3. Copy source code
COPY src ./src

# 4. Use the wrapper instead of the global 'gradle' command
# Added --stacktrace to help your agent "see" the specific error if it fails again
RUN ./gradlew build -x test --no-daemon --stacktrace

# Runtime stage
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S appgroup && adduser -u 1001 -S appuser -G appgroup
USER appuser

COPY --from=build /app/build/libs/*.jar app.jar

EXPOSE 8080

ENV JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0"

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
