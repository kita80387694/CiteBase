package io.citebase;

import org.springframework.context.annotation.*;
import org.springframework.core.env.Environment;

@Configuration
public class ModelConfiguration {
  @Bean
  RerankGateway rerankGateway(Environment env) {
    if ("mock".equals(env.getProperty("MODEL_MODE", "mock")))
      return new RerankGateway() {
        public Result rerank(String query, java.util.List<Evidence> documents, int topK) {
          throw new SpringAiGateway.ModelFailure("MOCK模式不调用真实reranker，请关闭rerank或切换真实模式", null);
        }

        public java.util.Map<String, Object> configuration() {
          return java.util.Map.of("provider", "disabled-in-mock", "configured", false);
        }
      };
    return new SiliconFlowRerankGateway(
        env.getProperty("RERANK_BASE_URL", "https://api.siliconflow.cn"),
        env.getProperty("RERANK_API_KEY"),
        env.getProperty("RERANK_MODEL", "BAAI/bge-reranker-v2-m3"),
        env.getProperty("RERANK_TIMEOUT_SECONDS", Integer.class, 30));
  }

  @Bean
  ModelGateway modelGateway(Environment env) {
    String mode = env.getProperty("MODEL_MODE", "mock");
    if (mode.equals("mock")) return new MockModelGateway();
    if (!mode.equals("real")) throw new IllegalArgumentException("MODEL_MODE 必须为 mock 或 real");
    return new SpringAiGateway(
        env.getProperty("CHAT_BASE_URL", "https://api.siliconflow.cn"),
        required(env, "CHAT_API_KEY"),
        env.getProperty("CHAT_MODEL", "deepseek-ai/DeepSeek-V3.2"),
        env.getProperty("EMBEDDING_BASE_URL", "https://api.siliconflow.cn"),
        required(env, "EMBEDDING_API_KEY"),
        env.getProperty("EMBEDDING_MODEL", "BAAI/bge-m3"),
        env.getProperty("MODEL_TIMEOUT_SECONDS", Integer.class, 60));
  }

  private String required(Environment env, String key) {
    String value = env.getProperty(key);
    if (value == null || value.isBlank()) throw new IllegalArgumentException("真实模型缺少环境变量 " + key);
    return value;
  }
}
