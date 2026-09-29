package io.citebase;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

@Configuration
public class AgentPlannerConfiguration {
  @Bean
  AgentPlannerGateway agentPlannerGateway(Environment env) {
    if ("mock".equals(env.getProperty("MODEL_MODE", "mock"))) return new MockAgentPlannerGateway();
    return new SpringAiAgentPlannerGateway(
        fallback(env, "AGENT_CHAT_BASE_URL", "CHAT_BASE_URL", "https://api.siliconflow.cn"),
        fallback(env, "AGENT_CHAT_API_KEY", "CHAT_API_KEY", ""),
        fallback(env, "AGENT_CHAT_MODEL", "CHAT_MODEL", "deepseek-ai/DeepSeek-V3.2"));
  }

  private static String fallback(Environment env, String name, String original, String value) {
    String configured = env.getProperty(name);
    return configured == null || configured.isBlank()
        ? env.getProperty(original, value)
        : configured;
  }
}
