package io.citebase;

public record Evidence(
    String id,
    String documentId,
    String documentName,
    String versionId,
    int page,
    int paragraph,
    int startOffset,
    int endOffset,
    String text,
    double score) {}
