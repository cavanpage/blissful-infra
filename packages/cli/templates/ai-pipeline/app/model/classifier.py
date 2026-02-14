import logging
import json
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.naive_bayes import MultinomialNB
import numpy as np

logger = logging.getLogger(__name__)

# Pre-seeded training data for demo classification
TRAINING_DATA = [
    ("hello", "greeting"),
    ("hi there", "greeting"),
    ("hey", "greeting"),
    ("good morning", "greeting"),
    ("good afternoon", "greeting"),
    ("welcome", "greeting"),
    ("howdy", "greeting"),
    ("greetings", "greeting"),
    ("goodbye", "farewell"),
    ("bye", "farewell"),
    ("see you later", "farewell"),
    ("farewell", "farewell"),
    ("take care", "farewell"),
    ("good night", "farewell"),
    ("catch you later", "farewell"),
    ("what is this", "question"),
    ("how does it work", "question"),
    ("why is that", "question"),
    ("where are you", "question"),
    ("when did it happen", "question"),
    ("who are you", "question"),
    ("can you help", "question"),
    ("wow", "exclamation"),
    ("amazing", "exclamation"),
    ("incredible", "exclamation"),
    ("awesome", "exclamation"),
    ("great job", "exclamation"),
    ("fantastic", "exclamation"),
    ("unbelievable", "exclamation"),
    ("the weather is nice", "neutral"),
    ("processing data", "neutral"),
    ("system update", "neutral"),
    ("running task", "neutral"),
    ("status report", "neutral"),
    ("log entry", "neutral"),
    ("event recorded", "neutral"),
]

SENTIMENT_MAP = {
    "greeting": "positive",
    "farewell": "neutral",
    "question": "neutral",
    "exclamation": "positive",
    "neutral": "neutral",
}


class EventClassifier:
    """Text classifier using TF-IDF + Multinomial Naive Bayes."""

    def __init__(self):
        self.vectorizer = TfidfVectorizer(lowercase=True, stop_words="english")
        self.model = MultinomialNB()
        self.classes = []
        self._train()

    def _train(self):
        texts = [t for t, _ in TRAINING_DATA]
        labels = [l for _, l in TRAINING_DATA]
        self.classes = sorted(set(labels))

        X = self.vectorizer.fit_transform(texts)
        self.model.fit(X, labels)
        logger.info("Classifier trained with %d samples, %d classes", len(texts), len(self.classes))

    def predict(self, event_json: str) -> dict:
        """Classify an event and return prediction with confidence."""
        try:
            event = json.loads(event_json) if isinstance(event_json, str) else event_json
        except (json.JSONDecodeError, TypeError):
            event = {"name": str(event_json)}

        text = event.get("name", "") or event.get("eventType", "") or ""
        if not text:
            return {
                "eventId": event.get("eventId", "unknown"),
                "category": "neutral",
                "confidence": 0.0,
                "sentiment": "neutral",
            }

        X = self.vectorizer.transform([text])
        category = self.model.predict(X)[0]
        probabilities = self.model.predict_proba(X)[0]
        confidence = float(np.max(probabilities))

        return {
            "eventId": event.get("eventId", "unknown"),
            "category": category,
            "confidence": round(confidence, 4),
            "sentiment": SENTIMENT_MAP.get(category, "neutral"),
        }
