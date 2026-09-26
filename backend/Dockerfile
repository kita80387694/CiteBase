FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml ./
RUN mvn -B dependency:go-offline
COPY src ./src
RUN mvn -B package -DskipTests
FROM eclipse-temurin:21-jre-jammy
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/* && useradd -m app
WORKDIR /app
COPY --from=build /app/target/citebase-0.1.0.jar app.jar
USER app
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
