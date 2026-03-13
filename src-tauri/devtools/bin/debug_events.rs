use reqwest::{Client, Response};
use std::error::Error;
use std::time::Duration;
use tokio::time::sleep;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    println!("Starting Live Client Data API Debugger...");
    println!("Attempting to connect to https://127.0.0.1:2999/liveclientdata/eventdata");

    // Create a client that ignores invalid certificates (self-signed)
    let client = Client::builder().danger_accept_invalid_certs(true).build()?;

    let mut last_event_count = 0;

    loop {
        // Fetch event data
        let resp: Result<Response, reqwest::Error> = client
            .get("https://127.0.0.1:2999/liveclientdata/eventdata")
            .send()
            .await;

        match resp {
            Ok(response) => {
                let status = response.status();
                if status.is_success() {
                    match response.text().await {
                        Ok(text) => {
                            // Simply parse as serde_json::Value to check structure
                            match serde_json::from_str::<serde_json::Value>(&text) {
                                Ok(json) => {
                                    if let Some(events) = json.get("Events").and_then(|e| e.as_array()) {
                                        let current_count = events.len();
                                        if current_count > last_event_count {
                                            println!("Found {} new events!", current_count - last_event_count);
                                            // Print the new events
                                            for event in events.iter().skip(last_event_count) {
                                                match serde_json::to_string_pretty(event) {
                                                    Ok(pretty_json) => println!("New Event: {}", pretty_json),
                                                    Err(e) => println!("Error formatting event: {}", e),
                                                }
                                            }
                                            last_event_count = current_count;
                                        }
                                    } else {
                                        println!("Response did not contain 'Events' array. Raw: {}", text);
                                    }
                                }
                                Err(e) => {
                                    println!("Failed to parse JSON: {}. Raw text: {}", e, text);
                                }
                            }
                        }
                        Err(e) => println!("Failed to read text: {}", e),
                    }
                } else {
                    println!("API returned status: {}", status);
                }
            }
            Err(e) => {
                println!("Failed to connect: {}. Is the game running?", e);
            }
        }

        sleep(Duration::from_secs(2)).await;
    }
}
