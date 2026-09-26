package io.citebase;

import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AuthService implements ApplicationRunner {
  private final JdbcTemplate db;
  private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();

  public AuthService(JdbcTemplate db) {
    this.db = db;
  }

  public void run(ApplicationArguments args) {
    for (String name : List.of("alice", "bob"))
      db.update(
          "insert into app_user(id,username,password_hash) values(?,?,?) on conflict(username) do"
              + " nothing",
          UUID.randomUUID().toString(),
          name,
          encoder.encode(name.equals("alice") ? "Alice-demo-123!" : "Bob-demo-123!"));
  }

  public Map<String, Object> login(String username, String password) {
    if (username == null || password == null || username.length() > 100 || password.length() > 100)
      throw unauthorized();
    var rows = db.queryForList("select id,password_hash from app_user where username=?", username);
    if (rows.size() != 1
        || !encoder.matches(password, (String) rows.getFirst().get("password_hash")))
      throw unauthorized();
    byte[] bytes = new byte[32];
    new SecureRandom().nextBytes(bytes);
    String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    String id = (String) rows.getFirst().get("id");
    db.update(
        "insert into auth_session(token_hash,user_id,expires_at) values(?,?,now()+interval '12"
            + " hours')",
        hash(token.getBytes(StandardCharsets.UTF_8)),
        id);
    return Map.of("token", token, "username", username, "userId", id);
  }

  public String require(HttpServletRequest request) {
    String header = request.getHeader("Authorization");
    if (header == null || !header.startsWith("Bearer ") || header.length() > 256)
      throw unauthorized();
    var ids =
        db.queryForList(
            "select user_id from auth_session where token_hash=? and expires_at>now()",
            String.class,
            hash(header.substring(7).getBytes(StandardCharsets.UTF_8)));
    if (ids.size() != 1) throw unauthorized();
    return ids.getFirst();
  }

  public static String hash(byte[] bytes) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  private static ResponseStatusException unauthorized() {
    return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "请登录或检查账号密码");
  }
}
