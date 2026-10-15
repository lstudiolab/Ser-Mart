use argon2::{password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString}, Argon2};
use axum::{
    body::Body, extract::{DefaultBodyLimit, Path, Query, State}, http::{header, HeaderMap, HeaderName, HeaderValue, StatusCode, Request},
    middleware::{self, Next}, response::{IntoResponse, Response}, routing::{get, patch, post, put}, Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{any::{install_default_drivers, AnyPoolOptions}, AnyPool, Row};
use std::{collections::HashMap, env, net::SocketAddr, sync::{Arc, Mutex}, time::{SystemTime, UNIX_EPOCH}};
use tower_http::{services::ServeDir, trace::TraceLayer};
use uuid::Uuid;

#[derive(Clone)]
struct AppState { pool: AnyPool, sessions: Arc<Mutex<HashMap<String, u64>>>, login_attempts: Arc<Mutex<HashMap<String, (u32, u64)>>> }
#[derive(Debug)]
struct ApiError(StatusCode, String);
impl ApiError {
    fn bad(s: impl Into<String>) -> Self { Self(StatusCode::BAD_REQUEST, s.into()) }
    fn auth() -> Self { Self(StatusCode::UNAUTHORIZED, "Please sign in again.".into()) }
    fn unauthorized() -> Self { Self::auth() }
    fn missing(s: impl Into<String>) -> Self { Self(StatusCode::NOT_FOUND, s.into()) }
    fn internal() -> Self { Self(StatusCode::INTERNAL_SERVER_ERROR, "Something went wrong. Please try again.".into()) }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response { (self.0, Json(json!({"error": self.1}))).into_response() }
}
#[derive(Deserialize)]
struct Login { password: String }
#[derive(Deserialize)]
struct RegisterInput { name: String, email: String, password: String }
#[derive(Deserialize)]
struct CustomerLoginInput { email: String, password: String }
#[derive(Deserialize)]
struct CustomerProfileInput {
    #[serde(default)] name: String,
    #[serde(default)] phone: String,
    #[serde(default)] address: String,
    #[serde(rename="exactPlace", default)] exact_place: String,
    #[serde(default)] request: String,
    #[serde(rename="primaryPayment", default="default_primary_payment")] primary_payment: String,
}
fn default_primary_payment() -> String { "COD".to_string() }
#[derive(Deserialize)]
struct ProductInput {
    name: String, #[serde(default)] description: String, price: f64, #[serde(rename="oldPrice", default)] old_price: f64, #[serde(rename="isPreOrder", default)] is_pre_order: bool, #[serde(default)] stock: i64,
    #[serde(default)] category: String, #[serde(rename="releaseDate", default)] release_date: String,
    #[serde(rename="imageUrl", default)] image_url: String, #[serde(default)] gallery: Value,
    #[serde(default)] selections: Value, #[serde(rename="isActive", default="active_default")] is_active: bool,
}
fn active_default() -> bool { true }
#[derive(Deserialize)]
struct ImageInput { #[serde(rename="dataUrl")] data_url: String }
#[derive(Deserialize)]
struct CartLine { #[serde(rename="productId")] product_id: i64, quantity: i64, #[serde(default)] selections: Value }
#[derive(Deserialize)]
struct OrderInput {
    #[serde(rename="customerName")] customer_name: String,
    #[serde(rename="contactNumber", alias="phone")] contact_number: String,
    address: String, #[serde(rename="exactPlace", default)] exact_place: String,
    #[serde(default)] request: String, #[serde(rename="paymentMethod")] payment_method: String,
    items: Vec<CartLine>,
}
#[derive(Deserialize)]
struct StatusInput { status: String, #[serde(default)] eta: String }
#[derive(Deserialize)]
struct MessageInput { text: String }
#[derive(Deserialize)]
struct SearchQuery { #[serde(default)] q: String }
#[derive(Deserialize)]
struct SearchTermInput { term: String }

fn now() -> String { chrono::Utc::now().to_rfc3339() }
fn epoch() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() }
fn admin_ok(h: &HeaderMap, s: &AppState) -> bool {
    let token = match h.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) {
        Some(v) if v.starts_with("Bearer ") => &v[7..], _ => return false,
    };
    let ts = epoch();
    let mut sessions = match s.sessions.lock() { Ok(v) => v, Err(_) => return false };
    sessions.retain(|_, expiry| *expiry > ts);
    sessions.get(token).is_some_and(|expiry| *expiry > ts)
}
async fn init_db(pool: &AnyPool, pg: bool) -> Result<(), sqlx::Error> {
    let id = if pg { "BIGSERIAL PRIMARY KEY" } else { "INTEGER PRIMARY KEY AUTOINCREMENT" };
    let sql = vec![
        format!("CREATE TABLE IF NOT EXISTS ser_mart_products (
            id {id}, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price DOUBLE PRECISION NOT NULL DEFAULT 0, old_price DOUBLE PRECISION NOT NULL DEFAULT 0,
            stock BIGINT NOT NULL DEFAULT 0, image_url TEXT NOT NULL DEFAULT '', gallery TEXT NOT NULL DEFAULT '[]',
            selections TEXT NOT NULL DEFAULT '[]', category TEXT NOT NULL DEFAULT 'Other', release_date TEXT NOT NULL DEFAULT '', is_pre_order BIGINT NOT NULL DEFAULT 0, is_active BIGINT NOT NULL DEFAULT 1, created_at TEXT NOT NULL
        )"),
        format!("CREATE TABLE IF NOT EXISTS ser_mart_orders (
            id {id}, customer_id BIGINT, customer_name TEXT NOT NULL, contact_number TEXT NOT NULL, address TEXT NOT NULL,
            exact_place TEXT NOT NULL DEFAULT '', request TEXT NOT NULL DEFAULT '', payment_method TEXT NOT NULL,
            items TEXT NOT NULL, total DOUBLE PRECISION NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'Pending',
            access_token TEXT NOT NULL UNIQUE, delivery_eta TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
        )"),
        format!("CREATE TABLE IF NOT EXISTS ser_mart_customers (
            id {id}, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
            phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', exact_place TEXT NOT NULL DEFAULT '',
            request TEXT NOT NULL DEFAULT '', primary_payment TEXT NOT NULL DEFAULT 'COD', created_at TEXT NOT NULL
        )"),
        "CREATE TABLE IF NOT EXISTS ser_mart_customer_sessions (token TEXT PRIMARY KEY, customer_id BIGINT NOT NULL, expires_at BIGINT NOT NULL, created_at TEXT NOT NULL)".to_string(),
        format!("CREATE TABLE IF NOT EXISTS ser_mart_order_messages (
            id {id}, order_id BIGINT NOT NULL, sender TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL
        )"),
        format!("CREATE TABLE IF NOT EXISTS ser_mart_images (
            id {id}, image_data TEXT NOT NULL, content_type TEXT NOT NULL, created_at TEXT NOT NULL
        )"),
        format!("CREATE TABLE IF NOT EXISTS ser_mart_categories (id {id}, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)"),
        "CREATE TABLE IF NOT EXISTS ser_mart_search_terms (term TEXT PRIMARY KEY, search_count BIGINT NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)".to_string(),
        "CREATE TABLE IF NOT EXISTS ser_mart_seller_profile (id BIGINT PRIMARY KEY, name TEXT NOT NULL DEFAULT 'Ser mart', phone TEXT NOT NULL DEFAULT '', gcash_number TEXT NOT NULL DEFAULT '', gcash_name TEXT NOT NULL DEFAULT '', pickup_address TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')".to_string(),
        "CREATE INDEX IF NOT EXISTS idx_ser_mart_orders_token ON ser_mart_orders(access_token)".to_string(),
        "CREATE INDEX IF NOT EXISTS idx_ser_mart_orders_customer ON ser_mart_orders(customer_id)".to_string(),
        "CREATE INDEX IF NOT EXISTS idx_ser_mart_customer_sessions_customer ON ser_mart_customer_sessions(customer_id)".to_string(),
        "CREATE INDEX IF NOT EXISTS idx_ser_mart_messages_order ON ser_mart_order_messages(order_id)".to_string(),
    ];
    for statement in sql { sqlx::query(&statement).execute(pool).await?; }
    let _ = sqlx::query("ALTER TABLE ser_mart_orders ADD COLUMN customer_id BIGINT").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE ser_mart_products ADD COLUMN category TEXT NOT NULL DEFAULT 'Other'").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE ser_mart_products ADD COLUMN release_date TEXT NOT NULL DEFAULT ''").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE ser_mart_products ADD COLUMN old_price DOUBLE PRECISION NOT NULL DEFAULT 0").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE ser_mart_products ADD COLUMN is_pre_order BIGINT NOT NULL DEFAULT 0").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE ser_mart_categories ADD COLUMN description TEXT NOT NULL DEFAULT ''").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE ser_mart_categories ADD COLUMN image_url TEXT NOT NULL DEFAULT ''").execute(pool).await;
    // Preserve existing product categories when seller-managed categories are introduced.
    let existing_categories = sqlx::query("SELECT DISTINCT category FROM ser_mart_products").fetch_all(pool).await?;
    for row in existing_categories {
        let raw: String = row.try_get("category").unwrap_or_default();
        let name = raw.split("::").next().unwrap_or("").trim().to_string();
        if name.is_empty() || name.eq_ignore_ascii_case("other") { continue; }
        sqlx::query("INSERT INTO ser_mart_categories (name, description, image_url, created_at) VALUES (?, '', '', ?) ON CONFLICT(name) DO NOTHING")
            .bind(name).bind(now()).execute(pool).await?;
    }
    Ok(())
}
fn parse_json(v: String, fallback: Value) -> Value { serde_json::from_str(&v).unwrap_or(fallback) }
fn product_json(r: &sqlx::any::AnyRow) -> Value {
    let stock: i64 = r.try_get("stock").unwrap_or_default();
    let gallery: String = r.try_get("gallery").unwrap_or_else(|_| "[]".into());
    let selections: String = r.try_get("selections").unwrap_or_else(|_| "[]".into());
    let active: i64 = r.try_get("is_active").unwrap_or(1);
    json!({
        "id": r.try_get::<i64,_>("id").unwrap_or_default(),
        "name": r.try_get::<String,_>("name").unwrap_or_default(),
        "description": r.try_get::<String,_>("description").unwrap_or_default(),
        "price": r.try_get::<f64,_>("price").unwrap_or_default(), "oldPrice": r.try_get::<f64,_>("old_price").unwrap_or_default(), "isPreOrder": r.try_get::<i64,_>("is_pre_order").unwrap_or_default() != 0, "stock": stock,
        "imageUrl": r.try_get::<String,_>("image_url").unwrap_or_default(),
        "gallery": parse_json(gallery, json!([])), "selections": parse_json(selections, json!([])),
        "category": r.try_get::<String,_>("category").unwrap_or_else(|_| "Other".into()),
        "releaseDate": r.try_get::<String,_>("release_date").unwrap_or_default(),
        "isActive": active != 0, "inStock": stock > 0,
        "createdAt": r.try_get::<String,_>("created_at").unwrap_or_default()
    })
}
fn order_json(r: &sqlx::any::AnyRow) -> Value {
    json!({
        "id": r.try_get::<i64,_>("id").unwrap_or_default(),
        "customerName": r.try_get::<String,_>("customer_name").unwrap_or_default(),
        "contactNumber": r.try_get::<String,_>("contact_number").unwrap_or_default(),
        "address": r.try_get::<String,_>("address").unwrap_or_default(),
        "exactPlace": r.try_get::<String,_>("exact_place").unwrap_or_default(),
        "request": r.try_get::<String,_>("request").unwrap_or_default(),
        "paymentMethod": r.try_get::<String,_>("payment_method").unwrap_or_default(),
        "items": parse_json(r.try_get::<String,_>("items").unwrap_or_else(|_| "[]".into()), json!([])),
        "total": r.try_get::<f64,_>("total").unwrap_or_default(),
        "status": r.try_get::<String,_>("status").unwrap_or_else(|_| "Pending".into()),
        "deliveryEta": r.try_get::<String,_>("delivery_eta").unwrap_or_default(),
        "createdAt": r.try_get::<String,_>("created_at").unwrap_or_default()
    })
}
async fn with_messages(pool: &AnyPool, mut order: Value) -> Result<Value, ApiError> {
    let id = order["id"].as_i64().unwrap_or_default();
    let rows = sqlx::query("SELECT id, sender, text, created_at FROM ser_mart_order_messages WHERE order_id = ? ORDER BY id ASC")
        .bind(id).fetch_all(pool).await.map_err(|_| ApiError::internal())?;
    order["messages"] = json!(rows.iter().map(|r| json!({
        "id": r.try_get::<i64,_>("id").unwrap_or_default(),
        "sender": r.try_get::<String,_>("sender").unwrap_or_default(),
        "text": r.try_get::<String,_>("text").unwrap_or_default(),
        "createdAt": r.try_get::<String,_>("created_at").unwrap_or_default()
    })).collect::<Vec<_>>());
    Ok(order)
}
fn price_for(base: f64, groups: &Value, selected: &Value) -> Result<f64, ApiError> {
    let mut total = base;
    for group in groups.as_array().cloned().unwrap_or_default() {
        let name = group.get("name").and_then(Value::as_str).unwrap_or("");
        if name.is_empty() { continue; }
        let choice = selected.get(name).and_then(Value::as_str).unwrap_or("");
        let options = group.get("options").and_then(Value::as_array).cloned().unwrap_or_default();
        let required = group.get("required").and_then(Value::as_bool).unwrap_or(true);
        if choice.is_empty() {
            if required && !options.is_empty() { return Err(ApiError::bad(format!("Please choose {name} for your item."))); }
            continue;
        }
        let option = options.iter().find(|o| o.get("name").and_then(Value::as_str) == Some(choice))
            .ok_or_else(|| ApiError::bad(format!("The selected {name} option is no longer available.")))?;
        total += option.get("priceDelta").or_else(|| option.get("price_delta")).and_then(Value::as_f64).unwrap_or(0.0);
    }
    Ok(total.max(0.0))
}
async fn security_headers(req: Request<Body>, next: Next) -> Response {
    let mut response = next.run(req).await;
    let h = response.headers_mut();
    h.insert(HeaderName::from_static("x-content-type-options"), HeaderValue::from_static("nosniff"));
    h.insert(HeaderName::from_static("x-frame-options"), HeaderValue::from_static("DENY"));
    h.insert(HeaderName::from_static("referrer-policy"), HeaderValue::from_static("strict-origin-when-cross-origin"));
    h.insert(HeaderName::from_static("permissions-policy"), HeaderValue::from_static("camera=(), microphone=(), geolocation=()"));
    h.insert(header::HeaderName::from_static("content-security-policy"), HeaderValue::from_static("default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"));
    h.insert(header::HeaderName::from_static("cross-origin-opener-policy"), HeaderValue::from_static("same-origin"));
    response
}
async fn html_index() -> Response {
    Response::builder().header(header::CONTENT_TYPE, "text/html; charset=utf-8").body(Body::from(include_str!("../public/index.html"))).unwrap()
}
async fn html_admin() -> Response {
    Response::builder().header(header::CONTENT_TYPE, "text/html; charset=utf-8").body(Body::from(include_str!("../public/admin.html"))).unwrap()
}
async fn health(State(s): State<AppState>) -> Result<Json<Value>, ApiError> { sqlx::query("SELECT 1").execute(&s.pool).await.map_err(|_| ApiError::internal())?; Ok(Json(json!({"ok":true,"name":"Ser mart","database":"connected"}))) }

async fn search_trends(State(s): State<AppState>) -> Result<Json<Value>,ApiError> {
    let rows = sqlx::query("SELECT term, search_count FROM ser_mart_search_terms ORDER BY search_count DESC, updated_at DESC LIMIT 8")
        .fetch_all(&s.pool).await.map_err(|_|ApiError::internal())?;
    Ok(Json(json!(rows.iter().map(|r| json!({
        "term": r.try_get::<String,_>("term").unwrap_or_default(),
        "count": r.try_get::<i64,_>("search_count").unwrap_or_default()
    })).collect::<Vec<_>>())))
}
async fn record_search(State(s): State<AppState>, Json(input): Json<SearchTermInput>) -> Result<Json<Value>,ApiError> {
    let term = input.term.trim().to_lowercase();
    if term.is_empty() || term.chars().count() > 60 {
        return Err(ApiError::bad("Search terms must be between 1 and 60 characters."));
    }
    sqlx::query("INSERT INTO ser_mart_search_terms (term, search_count, updated_at) VALUES (?, 1, ?) ON CONFLICT(term) DO UPDATE SET search_count = ser_mart_search_terms.search_count + 1, updated_at = excluded.updated_at")
        .bind(term).bind(now()).execute(&s.pool).await.map_err(|_|ApiError::internal())?;
    Ok(Json(json!({"ok": true})))
}
async fn list_products(State(s): State<AppState>, Query(q): Query<SearchQuery>) -> Result<Json<Value>,ApiError> {
    let rows = sqlx::query("SELECT * FROM ser_mart_products WHERE is_active = 1 ORDER BY id DESC")
        .fetch_all(&s.pool).await.map_err(|_|ApiError::internal())?;
    let needle=q.q.trim().to_lowercase();
    Ok(Json(json!(rows.iter().map(product_json).filter(|p| needle.is_empty() || p["name"].as_str().unwrap_or("").to_lowercase().contains(&needle)).collect::<Vec<_>>())))
}
async fn get_product(State(s):State<AppState>,Path(id):Path<i64>)->Result<Json<Value>,ApiError>{
    let row=sqlx::query("SELECT * FROM ser_mart_products WHERE id = ? AND is_active = 1").bind(id).fetch_optional(&s.pool).await.map_err(|_|ApiError::internal())?.ok_or_else(||ApiError::missing("This item is no longer available."))?;
    Ok(Json(product_json(&row)))
}
async fn get_image(State(s):State<AppState>,Path(id):Path<i64>)->Result<Response,ApiError>{
    let row=sqlx::query("SELECT image_data, content_type FROM ser_mart_images WHERE id = ?").bind(id).fetch_optional(&s.pool).await.map_err(|_|ApiError::internal())?.ok_or_else(||ApiError::missing("Photo not found."))?;
    let encoded:String=row.try_get("image_data").map_err(|_|ApiError::internal())?;
    let content_type:String=row.try_get("content_type").map_err(|_|ApiError::internal())?;
    let bytes=base64::Engine::decode(&base64::engine::general_purpose::STANDARD,encoded).map_err(|_|ApiError::internal())?;
    let mut response=Response::new(Body::from(bytes));
    response.headers_mut().insert(header::CONTENT_TYPE,HeaderValue::from_str(&content_type).unwrap_or(HeaderValue::from_static("application/octet-stream")));
    response.headers_mut().insert(header::CACHE_CONTROL,HeaderValue::from_static("no-store, max-age=0"));
    Ok(response)
}
async fn login(State(s):State<AppState>,headers:HeaderMap,Json(input):Json<Login>)->Result<Json<Value>,ApiError>{
    let key=headers.get("x-forwarded-for").and_then(|v|v.to_str().ok()).and_then(|v|v.split(',').next()).map(str::trim).filter(|v|!v.is_empty()).unwrap_or("unknown").to_string();
    let ts=epoch();
    { let mut attempts=s.login_attempts.lock().map_err(|_|ApiError::internal())?; attempts.retain(|_,(_,until)|*until>ts); if let Some((count,until))=attempts.get(&key) { if *count>=8 && *until>ts { return Err(ApiError(StatusCode::TOO_MANY_REQUESTS,"Too many sign-in attempts. Please wait 15 minutes.".into())); } } }
    let expected=env::var("ADMIN_PASSWORD").map_err(|_|ApiError::internal())?;
    if input.password != expected { let mut attempts=s.login_attempts.lock().map_err(|_|ApiError::internal())?; let entry=attempts.entry(key.clone()).or_insert((0,ts+900)); if entry.1<=ts { *entry=(0,ts+900); } entry.0=entry.0.saturating_add(1); return Err(ApiError(StatusCode::UNAUTHORIZED,"That password is not correct.".into())); }
    if let Ok(mut attempts)=s.login_attempts.lock(){attempts.remove(&key);}
    let token=Uuid::new_v4().to_string();
    let mut sessions=s.sessions.lock().map_err(|_|ApiError::internal())?;
    sessions.retain(|_,expiry|*expiry>epoch()); sessions.insert(token.clone(),epoch()+8*60*60);
    Ok(Json(json!({"token":token,"expiresIn":28800})))
}
async fn account_json(pool: &AnyPool, customer_id: i64) -> Result<Value, ApiError> {
    let row = sqlx::query("SELECT id,name,email,phone,address,exact_place,request,primary_payment,created_at FROM ser_mart_customers WHERE id=?")
        .bind(customer_id).fetch_optional(pool).await.map_err(|_| ApiError::internal())?
        .ok_or_else(|| ApiError::auth())?;
    Ok(json!({
        "id": row.try_get::<i64,_>("id").unwrap_or_default(),
        "name": row.try_get::<String,_>("name").unwrap_or_default(),
        "email": row.try_get::<String,_>("email").unwrap_or_default(),
        "phone": row.try_get::<String,_>("phone").unwrap_or_default(),
        "address": row.try_get::<String,_>("address").unwrap_or_default(),
        "exactPlace": row.try_get::<String,_>("exact_place").unwrap_or_default(),
        "request": row.try_get::<String,_>("request").unwrap_or_default(),
        "primaryPayment": row.try_get::<String,_>("primary_payment").unwrap_or_else(|_| "COD".into()),
        "createdAt": row.try_get::<String,_>("created_at").unwrap_or_default()
    }))
}
async fn customer_id_for_token(pool: &AnyPool, token: &str) -> Result<Option<i64>, ApiError> {
    let row = sqlx::query("SELECT customer_id FROM ser_mart_customer_sessions WHERE token=? AND expires_at>?")
        .bind(token).bind(epoch() as i64).fetch_optional(pool).await.map_err(|_| ApiError::internal())?;
    Ok(row.map(|r| r.try_get::<i64,_>("customer_id").unwrap_or_default()))
}
async fn customer_id_from_headers(pool: &AnyPool, headers: &HeaderMap) -> Result<i64, ApiError> {
    let token = bearer_token(headers).ok_or_else(ApiError::auth)?;
    customer_id_for_token(pool, token).await?.ok_or_else(ApiError::auth)
}
async fn create_customer_session(pool: &AnyPool, customer_id: i64) -> Result<String, ApiError> {
    let token = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO ser_mart_customer_sessions(token,customer_id,expires_at,created_at) VALUES(?,?,?,?)")
        .bind(token.clone()).bind(customer_id).bind((epoch()+30*24*60*60) as i64).bind(now())
        .execute(pool).await.map_err(|_| ApiError::internal())?;
    Ok(token)
}
async fn account_register(State(s): State<AppState>, Json(input): Json<RegisterInput>) -> Result<Json<Value>, ApiError> {
    let name = input.name.trim();
    let email = input.email.trim().to_lowercase();
    if name.chars().count() < 2 || name.chars().count() > 100 { return Err(ApiError::bad("Enter a name between 2 and 100 characters.")); }
    if email.len() > 254 || !email.contains('@') || email.starts_with('@') || email.ends_with('@') || email.contains(' ') { return Err(ApiError::bad("Enter a valid email address.")); }
    if input.password.chars().count() < 8 || input.password.chars().count() > 128 { return Err(ApiError::bad("Your password must be between 8 and 128 characters.")); }
    let duplicate = sqlx::query("SELECT id FROM ser_mart_customers WHERE email=?").bind(email.clone()).fetch_optional(&s.pool).await.map_err(|_| ApiError::internal())?;
    if duplicate.is_some() { return Err(ApiError::bad("An account with this email already exists. Sign in instead.")); }
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default().hash_password(input.password.as_bytes(), &salt).map_err(|_| ApiError::internal())?.to_string();
    let row = sqlx::query("INSERT INTO ser_mart_customers(name,email,password_hash,created_at) VALUES(?,?,?,?) RETURNING id")
        .bind(name.to_string()).bind(email).bind(hash).bind(now()).fetch_one(&s.pool).await
        .map_err(|_| ApiError::bad("An account with this email may already exist. Try signing in."))?;
    let id: i64 = row.try_get("id").map_err(|_| ApiError::internal())?;
    let token = create_customer_session(&s.pool, id).await?;
    Ok(Json(json!({"token":token,"expiresIn":30*24*60*60,"account":account_json(&s.pool,id).await?})))
}
async fn account_login(State(s): State<AppState>, headers: HeaderMap, Json(input): Json<CustomerLoginInput>) -> Result<Json<Value>, ApiError> {
    let key = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()).and_then(|v| v.split(',').next()).map(str::trim).filter(|v| !v.is_empty()).unwrap_or("unknown").to_string();
    let ts = epoch();
    { let mut attempts=s.login_attempts.lock().map_err(|_|ApiError::internal())?; attempts.retain(|_,(_,until)|*until>ts); if let Some((count,until))=attempts.get(&key) { if *count>=8 && *until>ts { return Err(ApiError(StatusCode::TOO_MANY_REQUESTS,"Too many sign-in attempts. Please wait 15 minutes.".into())); } } }
    let email = input.email.trim().to_lowercase();
    let row = sqlx::query("SELECT id,password_hash FROM ser_mart_customers WHERE email=?").bind(email).fetch_optional(&s.pool).await.map_err(|_|ApiError::internal())?;
    let valid = if let Some(ref user) = row {
        let hash: String = user.try_get("password_hash").unwrap_or_default();
        PasswordHash::new(&hash).ok().is_some_and(|parsed| Argon2::default().verify_password(input.password.as_bytes(), &parsed).is_ok())
    } else { false };
    if !valid {
        let mut attempts=s.login_attempts.lock().map_err(|_|ApiError::internal())?;
        let entry=attempts.entry(key.clone()).or_insert((0,ts+900)); if entry.1<=ts { *entry=(0,ts+900); } entry.0=entry.0.saturating_add(1);
        return Err(ApiError(StatusCode::UNAUTHORIZED,"Email or password is incorrect.".into()));
    }
    if let Ok(mut attempts)=s.login_attempts.lock(){attempts.remove(&key);}
    let id: i64 = row.ok_or_else(ApiError::auth)?.try_get("id").map_err(|_|ApiError::internal())?;
    let token = create_customer_session(&s.pool, id).await?;
    Ok(Json(json!({"token":token,"expiresIn":30*24*60*60,"account":account_json(&s.pool,id).await?})))
}
async fn account_me(State(s): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, ApiError> {
    let id = customer_id_from_headers(&s.pool, &headers).await?;
    Ok(Json(account_json(&s.pool,id).await?))
}
async fn account_update(State(s): State<AppState>, headers: HeaderMap, Json(input): Json<CustomerProfileInput>) -> Result<Json<Value>, ApiError> {
    let id = customer_id_from_headers(&s.pool, &headers).await?;
    let name = input.name.trim();
    if name.chars().count() < 2 || name.chars().count() > 100 { return Err(ApiError::bad("Enter a name between 2 and 100 characters.")); }
    if !["COD","GCash","COP"].contains(&input.primary_payment.as_str()) { return Err(ApiError::bad("Choose a valid primary payment method.")); }
    if input.phone.len()>40 || input.address.len()>500 || input.exact_place.len()>250 || input.request.len()>1000 { return Err(ApiError::bad("One of your delivery fields is too long.")); }
    sqlx::query("UPDATE ser_mart_customers SET name=?,phone=?,address=?,exact_place=?,request=?,primary_payment=? WHERE id=?")
        .bind(name.to_string()).bind(input.phone.trim().to_string()).bind(input.address.trim().to_string()).bind(input.exact_place.trim().to_string()).bind(input.request.trim().to_string()).bind(input.primary_payment).bind(id)
        .execute(&s.pool).await.map_err(|_| ApiError::internal())?;
    Ok(Json(account_json(&s.pool,id).await?))
}
async fn account_logout(State(s): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, ApiError> {
    let token = bearer_token(&headers).ok_or_else(ApiError::auth)?;
    sqlx::query("DELETE FROM ser_mart_customer_sessions WHERE token=?").bind(token).execute(&s.pool).await.map_err(|_|ApiError::internal())?;
    Ok(Json(json!({"ok":true})))
}
async fn account_orders(State(s): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, ApiError> {
    let id = customer_id_from_headers(&s.pool, &headers).await?;
    let rows = sqlx::query("SELECT * FROM ser_mart_orders WHERE customer_id=? ORDER BY id DESC").bind(id).fetch_all(&s.pool).await.map_err(|_|ApiError::internal())?;
    let mut orders = Vec::new();
    for row in rows { orders.push(with_messages(&s.pool, order_json(&row)).await?); }
    Ok(Json(json!(orders)))
}
async fn admin_products(State(s):State<AppState>,headers:HeaderMap)->Result<Json<Value>,ApiError>{
    if !admin_ok(&headers,&s){return Err(ApiError::auth());}
    let rows=sqlx::query("SELECT * FROM ser_mart_products ORDER BY id DESC").fetch_all(&s.pool).await.map_err(|_|ApiError::internal())?;
    Ok(Json(json!(rows.iter().map(product_json).collect::<Vec<_>>())))
}
async fn save_product(pool:&AnyPool,input:ProductInput,id:Option<i64>)->Result<Value,ApiError>{
    let name=input.name.trim().to_string();
    if name.is_empty(){return Err(ApiError::bad("Please enter an item name."));}
    if !input.price.is_finite()||input.price<0.0{return Err(ApiError::bad("Enter a valid price."));}
    if !input.old_price.is_finite()||input.old_price<0.0{return Err(ApiError::bad("Enter a valid old price."));}
    if input.stock<0{return Err(ApiError::bad("Stock cannot be below zero."));}
    let gallery=serde_json::to_string(&if input.gallery.is_array(){input.gallery}else{json!([])}).map_err(|_|ApiError::internal())?;
    let selections=serde_json::to_string(&if input.selections.is_array(){input.selections}else{json!([])}).map_err(|_|ApiError::internal())?;
    let active=1_i64; // Stock changes never hide an item; only the explicit delete action removes it.
    let product_id=if let Some(id)=id{
        let r=sqlx::query("UPDATE ser_mart_products SET name=?,description=?,price=?,old_price=?,stock=?,image_url=?,gallery=?,selections=?,category=?,release_date=?,is_pre_order=?,is_active=? WHERE id=?")
            .bind(name).bind(input.description.trim().to_string()).bind(input.price).bind(input.old_price).bind(input.stock).bind(input.image_url).bind(gallery).bind(selections).bind(input.category).bind(input.release_date).bind(if input.is_pre_order {1_i64} else {0_i64}).bind(active).bind(id)
            .execute(pool).await.map_err(|_|ApiError::internal())?;
        if r.rows_affected()==0{return Err(ApiError::missing("Item not found."));} id
    }else{
        let r=sqlx::query("INSERT INTO ser_mart_products (name,description,price,old_price,stock,image_url,gallery,selections,category,release_date,is_pre_order,is_active,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id")
            .bind(name).bind(input.description.trim().to_string()).bind(input.price).bind(input.old_price).bind(input.stock).bind(input.image_url).bind(gallery).bind(selections).bind(input.category).bind(input.release_date).bind(if input.is_pre_order {1_i64} else {0_i64}).bind(active).bind(now())
            .fetch_one(pool).await.map_err(|_|ApiError::internal())?;
        r.try_get("id").map_err(|_|ApiError::internal())?
    };
    let row=sqlx::query("SELECT * FROM ser_mart_products WHERE id=?").bind(product_id).fetch_one(pool).await.map_err(|_|ApiError::internal())?;
    Ok(product_json(&row))
}
async fn admin_create_product(State(s):State<AppState>,headers:HeaderMap,Json(input):Json<ProductInput>)->Result<Json<Value>,ApiError>{
    if !admin_ok(&headers,&s){return Err(ApiError::auth());} Ok(Json(save_product(&s.pool,input,None).await?))
}
async fn admin_update_product(State(s):State<AppState>,headers:HeaderMap,Path(id):Path<i64>,Json(input):Json<ProductInput>)->Result<Json<Value>,ApiError>{
    if !admin_ok(&headers,&s){return Err(ApiError::auth());} Ok(Json(save_product(&s.pool,input,Some(id)).await?))
}
async fn admin_delete_product(State(s):State<AppState>,headers:HeaderMap,Path(id):Path<i64>)->Result<Json<Value>,ApiError>{
    if !admin_ok(&headers,&s){return Err(ApiError::auth());}
    let r=sqlx::query("UPDATE ser_mart_products SET is_active=0 WHERE id=?").bind(id).execute(&s.pool).await.map_err(|_|ApiError::internal())?;
    if r.rows_affected()==0{return Err(ApiError::missing("Item not found."));} Ok(Json(json!({"ok":true})))
}
async fn upload_image(State(s):State<AppState>,headers:HeaderMap,Json(input):Json<ImageInput>)->Result<Json<Value>,ApiError>{
    if !admin_ok(&headers,&s){return Err(ApiError::auth());}
    if input.data_url.len()>7_000_000{return Err(ApiError::bad("Each photo must be smaller than 5 MB."));}
    let (meta,encoded)=input.data_url.split_once(',').ok_or_else(||ApiError::bad("Choose a valid photo."))?;
    let content_type=meta.strip_prefix("data:").and_then(|v|v.split(';').next()).unwrap_or("");
    if !["image/jpeg","image/png","image/webp","image/gif"].contains(&content_type){return Err(ApiError::bad("Use a JPG, PNG, WEBP or GIF photo."));}
    let bytes=base64::Engine::decode(&base64::engine::general_purpose::STANDARD,encoded).map_err(|_|ApiError::bad("That photo could not be read."))?;
    if bytes.is_empty()||bytes.len()>5*1024*1024{return Err(ApiError::bad("Each photo must be smaller than 5 MB."));}
    let data=base64::Engine::encode(&base64::engine::general_purpose::STANDARD,bytes);
    let row=sqlx::query("INSERT INTO ser_mart_images (image_data,content_type,created_at) VALUES (?,?,?) RETURNING id")
        .bind(data).bind(content_type.to_string()).bind(now()).fetch_one(&s.pool).await.map_err(|_|ApiError::internal())?;
    let id:i64=row.try_get("id").map_err(|_|ApiError::internal())?;
    Ok(Json(json!({"imageUrl":format!("/api/images/{id}")})))
}


#[derive(Deserialize)]
struct CategoryInput {
    name: String,
    #[serde(default)] description: String,
    #[serde(rename="imageUrl", default)] image_url: String,
}
fn category_json(r: &sqlx::any::AnyRow) -> Value {
    json!({
        "id": r.try_get::<i64,_>("id").unwrap_or_default(),
        "name": r.try_get::<String,_>("name").unwrap_or_default(),
        "description": r.try_get::<String,_>("description").unwrap_or_default(),
        "imageUrl": r.try_get::<String,_>("image_url").unwrap_or_default(),
        "createdAt": r.try_get::<String,_>("created_at").unwrap_or_default(),
        "productCount": r.try_get::<i64,_>("product_count").unwrap_or_default()
    })
}
async fn category_list(pool: &AnyPool) -> Result<Value, ApiError> {
    let rows = sqlx::query("SELECT c.id, c.name, c.description, c.image_url, c.created_at, (SELECT COUNT(*) FROM ser_mart_products p WHERE p.is_active=1 AND (p.category=c.name OR p.category LIKE c.name || '::%')) AS product_count FROM ser_mart_categories c ORDER BY c.id ASC")
        .fetch_all(pool).await.map_err(|_| ApiError::internal())?;
    Ok(json!(rows.iter().map(category_json).collect::<Vec<_>>()))
}
async fn list_categories(State(s): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(category_list(&s.pool).await?))
}
async fn admin_categories(State(s): State<AppState>, h: HeaderMap) -> Result<Json<Value>, ApiError> {
    if !admin_ok(&h, &s) { return Err(ApiError::auth()); }
    Ok(Json(category_list(&s.pool).await?))
}
async fn create_category(State(s): State<AppState>, h: HeaderMap, Json(input): Json<CategoryInput>) -> Result<Json<Value>, ApiError> {
    if !admin_ok(&h, &s) { return Err(ApiError::auth()); }
    let name = input.name.trim().to_string();
    let description = input.description.trim().to_string();
    let image_url = input.image_url.trim().to_string();
    if name.is_empty() || name.chars().count() > 60 { return Err(ApiError::bad("Enter a category name up to 60 characters.")); }
    if description.chars().count() > 500 { return Err(ApiError::bad("Category description must be 500 characters or fewer.")); }
    let exists = sqlx::query("SELECT id FROM ser_mart_categories WHERE LOWER(name)=LOWER(?)").bind(&name).fetch_optional(&s.pool).await.map_err(|_| ApiError::internal())?;
    if exists.is_some() { return Err(ApiError::bad("That category already exists. Choose another name.")); }
    sqlx::query("INSERT INTO ser_mart_categories (name, description, image_url, created_at) VALUES (?,?,?,?)")
        .bind(name).bind(description).bind(image_url).bind(now()).execute(&s.pool).await.map_err(|_| ApiError::internal())?;
    Ok(Json(category_list(&s.pool).await?))
}
async fn update_category(State(s): State<AppState>, h: HeaderMap, Path(id): Path<i64>, Json(input): Json<CategoryInput>) -> Result<Json<Value>, ApiError> {
    if !admin_ok(&h, &s) { return Err(ApiError::auth()); }
    let name = input.name.trim().to_string();
    let description = input.description.trim().to_string();
    let image_url = input.image_url.trim().to_string();
    if name.is_empty() || name.chars().count() > 60 { return Err(ApiError::bad("Enter a category name up to 60 characters.")); }
    if description.chars().count() > 500 { return Err(ApiError::bad("Category description must be 500 characters or fewer.")); }
    let old_row = sqlx::query("SELECT name FROM ser_mart_categories WHERE id=?").bind(id).fetch_optional(&s.pool).await.map_err(|_| ApiError::internal())?.ok_or_else(|| ApiError::missing("Category not found."))?;
    let old_name: String = old_row.try_get("name").unwrap_or_default();
    let exists = sqlx::query("SELECT id FROM ser_mart_categories WHERE LOWER(name)=LOWER(?) AND id<>?").bind(&name).bind(id).fetch_optional(&s.pool).await.map_err(|_| ApiError::internal())?;
    if exists.is_some() { return Err(ApiError::bad("That category already exists. Choose another name.")); }
    if old_name != name {
        let rows = sqlx::query("SELECT id, category FROM ser_mart_products").fetch_all(&s.pool).await.map_err(|_| ApiError::internal())?;
        for row in rows {
            let product_id: i64 = row.try_get("id").unwrap_or_default();
            let category: String = row.try_get("category").unwrap_or_default();
            if category == old_name || category.starts_with(&(old_name.clone() + "::")) {
                let suffix = category.strip_prefix(&old_name).unwrap_or("");
                sqlx::query("UPDATE ser_mart_products SET category=? WHERE id=?").bind(format!("{name}{suffix}")).bind(product_id).execute(&s.pool).await.map_err(|_| ApiError::internal())?;
            }
        }
    }
    sqlx::query("UPDATE ser_mart_categories SET name=?, description=?, image_url=? WHERE id=?")
        .bind(name).bind(description).bind(image_url).bind(id).execute(&s.pool).await.map_err(|_| ApiError::internal())?;
    Ok(Json(category_list(&s.pool).await?))
}
async fn delete_category(State(s): State<AppState>, h: HeaderMap, Path(id): Path<i64>) -> Result<Json<Value>, ApiError> {
    if !admin_ok(&h, &s) { return Err(ApiError::auth()); }
    let row = sqlx::query("SELECT name FROM ser_mart_categories WHERE id=?").bind(id).fetch_optional(&s.pool).await.map_err(|_| ApiError::internal())?.ok_or_else(|| ApiError::missing("Category not found."))?;
    let name: String = row.try_get("name").unwrap_or_default();
    // Keep products, orders, and images; remove only their category assignment.
    let products = sqlx::query("SELECT id, category FROM ser_mart_products").fetch_all(&s.pool).await.map_err(|_| ApiError::internal())?;
    for product in products {
        let product_id: i64 = product.try_get("id").unwrap_or_default();
        let product_category: String = product.try_get("category").unwrap_or_default();
        if product_category == name || product_category.starts_with(&(name.clone() + "::")) {
            sqlx::query("UPDATE ser_mart_products SET category='' WHERE id=?").bind(product_id).execute(&s.pool).await.map_err(|_| ApiError::internal())?;
        }
    }
    sqlx::query("DELETE FROM ser_mart_categories WHERE id=?").bind(id).execute(&s.pool).await.map_err(|_| ApiError::internal())?;
    Ok(Json(json!({"ok":true, "category":name})))
}

#[derive(Deserialize)]
struct SellerInfoInput { #[serde(default)] name:String, #[serde(default)] phone:String, #[serde(rename="gcashNumber",default)] gcash_number:String, #[serde(rename="gcashName",default)] gcash_name:String, #[serde(rename="pickupAddress",default)] pickup_address:String }
fn seller_info_json(r:&sqlx::any::AnyRow)->Value { json!({"name":r.try_get::<String,_>("name").unwrap_or_default(),"phone":r.try_get::<String,_>("phone").unwrap_or_default(),"gcashNumber":r.try_get::<String,_>("gcash_number").unwrap_or_default(),"gcashName":r.try_get::<String,_>("gcash_name").unwrap_or_default(),"pickupAddress":r.try_get::<String,_>("pickup_address").unwrap_or_default()}) }
async fn get_seller_info(State(s):State<AppState>)->Result<Json<Value>,ApiError>{let row=sqlx::query("SELECT name,phone,gcash_number,gcash_name,pickup_address FROM ser_mart_seller_profile WHERE id=1").fetch_optional(&s.pool).await.map_err(|_|ApiError::internal())?;Ok(Json(row.map(|r|seller_info_json(&r)).unwrap_or(json!({"name":"Ser mart","phone":"","gcashNumber":"","gcashName":"","pickupAddress":""}))))}
async fn admin_seller_info(State(s):State<AppState>,h:HeaderMap)->Result<Json<Value>,ApiError>{if !admin_ok(&h,&s){return Err(ApiError::auth());}get_seller_info(State(s)).await}
async fn update_seller_info(State(s):State<AppState>,h:HeaderMap,Json(i):Json<SellerInfoInput>)->Result<Json<Value>,ApiError>{if !admin_ok(&h,&s){return Err(ApiError::auth());}sqlx::query("INSERT INTO ser_mart_seller_profile (id,name,phone,gcash_number,gcash_name,pickup_address,updated_at) VALUES (1,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,gcash_number=excluded.gcash_number,gcash_name=excluded.gcash_name,pickup_address=excluded.pickup_address,updated_at=excluded.updated_at").bind(i.name.trim()).bind(i.phone.trim()).bind(i.gcash_number.trim()).bind(i.gcash_name.trim()).bind(i.pickup_address.trim()).bind(now()).execute(&s.pool).await.map_err(|_|ApiError::internal())?;get_seller_info(State(s)).await}
async fn create_order(State(s):State<AppState>,headers:HeaderMap,Json(input):Json<OrderInput>)->Result<Json<Value>,ApiError>{
    let customer_id = customer_id_from_headers(&s.pool, &headers).await?;
    if input.customer_name.trim().is_empty(){return Err(ApiError::bad("Please enter your name."));}
    if input.contact_number.trim().is_empty(){return Err(ApiError::bad("Please enter your contact number."));}
    if input.address.trim().is_empty(){return Err(ApiError::bad("Please enter your address."));}
    if input.exact_place.trim().is_empty(){return Err(ApiError::bad("Please add the exact place to deliver to."));}
    if !["COD","GCash","COP"].contains(&input.payment_method.as_str()){return Err(ApiError::bad("Choose GCash, cash on delivery, or cash on pickup."));}
    if input.items.is_empty()||input.items.len()>50{return Err(ApiError::bad("Your cart is empty or has too many items."));}
    let mut tx=s.pool.begin().await.map_err(|_|ApiError::internal())?;
    let mut counts:HashMap<i64,i64>=HashMap::new(); let mut snapshots=Vec::new(); let mut total=0.0_f64;
    for line in input.items {
        if line.quantity<1||line.quantity>50{return Err(ApiError::bad("Choose a valid quantity."));}
        let row=sqlx::query("SELECT * FROM ser_mart_products WHERE id=? AND is_active=1").bind(line.product_id).fetch_optional(&mut *tx).await.map_err(|_|ApiError::internal())?.ok_or_else(||ApiError::bad("One of the items is no longer available."))?;
        let p=product_json(&row); let count=counts.entry(line.product_id).or_insert(0); *count+=line.quantity;
        if p["isPreOrder"].as_bool().unwrap_or(false) && *count > 1 { return Err(ApiError::bad("Pre-orders are limited to one unit per item.")); }
        if p["stock"].as_i64().unwrap_or(0)<*count{return Err(ApiError::bad(format!("There is not enough stock for {}.",p["name"].as_str().unwrap_or("this item"))));}
        let opts=if line.selections.is_object(){line.selections}else{json!({})};
        let unit=price_for(p["price"].as_f64().unwrap_or(0.0),&p["selections"],&opts)?;
        let subtotal=unit*line.quantity as f64;total+=subtotal;
        snapshots.push(json!({"productId":line.product_id,"name":p["name"],"imageUrl":p["imageUrl"],"unitPrice":unit,"basePrice":p["price"],"quantity":line.quantity,"isPreOrder":p["isPreOrder"],"selections":opts,"subtotal":subtotal}));
    }
    let access=Uuid::new_v4().to_string(); let items=serde_json::to_string(&snapshots).map_err(|_|ApiError::internal())?;
    let row=sqlx::query("INSERT INTO ser_mart_orders (customer_id,customer_name,contact_number,address,exact_place,request,payment_method,items,total,status,access_token,delivery_eta,created_at) VALUES (?,?,?,?,?,?,?,?,?,'Pending',?,'',?) RETURNING id")
        .bind(customer_id).bind(input.customer_name.trim().to_string()).bind(input.contact_number.trim().to_string()).bind(input.address.trim().to_string()).bind(input.exact_place.trim().to_string()).bind(input.request.trim().to_string()).bind(input.payment_method).bind(items).bind(total).bind(access.clone()).bind(now())
        .fetch_one(&mut *tx).await.map_err(|_|ApiError::internal())?;
    let id:i64=row.try_get("id").map_err(|_|ApiError::internal())?;
    for (pid,qty) in counts {let changed=sqlx::query("UPDATE ser_mart_products SET stock=stock-? WHERE id=? AND stock>=? AND is_active=1").bind(qty).bind(pid).bind(qty).execute(&mut *tx).await.map_err(|_|ApiError::internal())?;if changed.rows_affected()==0{return Err(ApiError::bad("Stock changed while you were checking out. Please refresh your cart and try again."));}}
    tx.commit().await.map_err(|_|ApiError::internal())?;
    Ok(Json(json!({"id":id,"accessToken":access,"status":"Pending","total":total,"createdAt":now()})))
}

fn bearer_token(headers:&HeaderMap)->Option<&str>{
    headers.get(header::AUTHORIZATION).and_then(|v|v.to_str().ok()).and_then(|v|v.strip_prefix("Bearer ")).map(str::trim).filter(|v|!v.is_empty())
}
async fn my_order(State(s):State<AppState>,headers:HeaderMap)->Result<Json<Value>,ApiError>{
    let token=bearer_token(&headers).ok_or_else(ApiError::auth)?;
    let row=sqlx::query("SELECT * FROM ser_mart_orders WHERE access_token=?").bind(token).fetch_optional(&s.pool).await.map_err(|_|ApiError::internal())?.ok_or_else(||ApiError::missing("Order not found. Check the saved order on this device."))?;
    Ok(Json(with_messages(&s.pool,order_json(&row)).await?))
}
async fn cancel_order(State(s):State<AppState>,headers:HeaderMap,Path(id):Path<i64>)->Result<Json<Value>,ApiError>{
    let token=bearer_token(&headers).ok_or_else(ApiError::auth)?;
    let account_id=customer_id_for_token(&s.pool,token).await?;
    let mut tx=s.pool.begin().await.map_err(|_|ApiError::internal())?;
    let row=sqlx::query("SELECT * FROM ser_mart_orders WHERE id=?").bind(id).fetch_optional(&mut *tx).await.map_err(|_|ApiError::internal())?.ok_or_else(||ApiError::missing("Order not found."))?;
    let order_token:String=row.try_get("access_token").unwrap_or_default();
    let owner_id:Option<i64>=row.try_get("customer_id").ok();
    if order_token!=token && (account_id.is_none() || owner_id!=account_id) { return Err(ApiError::auth()); }
    let status:String=row.try_get("status").unwrap_or_default();
    if status!="Pending"{return Err(ApiError::bad("Only pending orders can be cancelled. Message the seller if you need help."));}
    let created:String=row.try_get("created_at").unwrap_or_default();
    let created_at=chrono::DateTime::parse_from_rfc3339(&created).map_err(|_|ApiError::bad("This order's creation time could not be verified. Please message the seller."))?;
    if chrono::Utc::now().signed_duration_since(created_at.with_timezone(&chrono::Utc)).num_seconds() >= 3600 {
        return Err(ApiError::bad("The one-hour cancellation window has ended. Please message the seller for help."));
    }
    let items=parse_json(row.try_get("items").unwrap_or_else(|_|"[]".into()),json!([]));
    let changed=sqlx::query("UPDATE ser_mart_orders SET status='Cancelled' WHERE id=? AND status='Pending'").bind(id).execute(&mut *tx).await.map_err(|_|ApiError::internal())?;
    if changed.rows_affected()==0{return Err(ApiError::bad("This order has already been updated."));}
    for item in items.as_array().cloned().unwrap_or_default(){
        let pid=item["productId"].as_i64().unwrap_or(0);let qty=item["quantity"].as_i64().unwrap_or(0);
        if pid>0&&qty>0{sqlx::query("UPDATE ser_mart_products SET stock=stock+? WHERE id=? AND is_active=1").bind(qty).bind(pid).execute(&mut *tx).await.map_err(|_|ApiError::internal())?;}
    }
    tx.commit().await.map_err(|_|ApiError::internal())?;
    Ok(Json(json!({"ok":true,"status":"Cancelled"})))
}
async fn admin_orders(State(s):State<AppState>,headers:HeaderMap)->Result<Json<Value>,ApiError>{
    if !admin_ok(&headers,&s){return Err(ApiError::auth());}
    let rows=sqlx::query("SELECT * FROM ser_mart_orders ORDER BY id DESC").fetch_all(&s.pool).await.map_err(|_|ApiError::internal())?;
    let mut all=Vec::new();for row in rows{all.push(with_messages(&s.pool,order_json(&row)).await?);}Ok(Json(json!(all)))
}
async fn set_order_status(State(s):State<AppState>,headers:HeaderMap,Path(id):Path<i64>,Json(input):Json<StatusInput>)->Result<Json<Value>,ApiError>{
    if !admin_ok(&headers,&s){return Err(ApiError::auth());}
    let allowed=["Pending","Confirmed","Preparing","Out for delivery","Delivered","Cancelled"];
    if !allowed.contains(&input.status.as_str()){return Err(ApiError::bad("Choose a valid order status."));}
    let mut tx=s.pool.begin().await.map_err(|_|ApiError::internal())?;
    let row=sqlx::query("SELECT * FROM ser_mart_orders WHERE id=?").bind(id).fetch_optional(&mut *tx).await.map_err(|_|ApiError::internal())?.ok_or_else(||ApiError::missing("Order not found."))?;
    let old:String=row.try_get("status").unwrap_or_default();
    if old=="Cancelled"&&input.status!="Cancelled"{return Err(ApiError::bad("A cancelled order cannot be reopened."));}
    if old=="Delivered"&&input.status=="Cancelled"{return Err(ApiError::bad("A delivered order cannot be cancelled."));}
    if old=="Cancelled"&&input.status=="Cancelled"{return Ok(Json(json!({"ok":true,"status":"Cancelled"})));}
    let changed=sqlx::query("UPDATE ser_mart_orders SET status=?,delivery_eta=? WHERE id=? AND status=?")
        .bind(input.status.clone()).bind(input.eta.trim().to_string()).bind(id).bind(old.clone())
        .execute(&mut *tx).await.map_err(|_|ApiError::internal())?;
    if changed.rows_affected()==0{return Err(ApiError::bad("This order has already been updated. Refresh and try again."));}
    if input.status=="Cancelled"&&old!="Delivered"{
        let items=parse_json(row.try_get("items").unwrap_or_else(|_|"[]".into()),json!([]));
        for item in items.as_array().cloned().unwrap_or_default(){
            let pid=item["productId"].as_i64().unwrap_or(0);let qty=item["quantity"].as_i64().unwrap_or(0);
            if pid>0&&qty>0{sqlx::query("UPDATE ser_mart_products SET stock=stock+? WHERE id=?").bind(qty).bind(pid).execute(&mut *tx).await.map_err(|_|ApiError::internal())?;}
        }
    }
    tx.commit().await.map_err(|_|ApiError::internal())?;
    Ok(Json(json!({"ok":true,"status":input.status})))
}
async fn send_message(State(s):State<AppState>,headers:HeaderMap,Path(id):Path<i64>,Json(input):Json<MessageInput>)->Result<Json<Value>,ApiError>{
    let text=input.text.trim();if text.is_empty(){return Err(ApiError::bad("Write a message first."));}if text.len()>2000{return Err(ApiError::bad("Messages must be under 2,000 characters."));}
    let seller=admin_ok(&headers,&s);
    if seller {let found=sqlx::query("SELECT id FROM ser_mart_orders WHERE id=?").bind(id).fetch_optional(&s.pool).await.map_err(|_|ApiError::internal())?;if found.is_none(){return Err(ApiError::missing("Order not found."));}}
    else {
        let token=bearer_token(&headers).ok_or_else(ApiError::auth)?;
        let order=sqlx::query("SELECT access_token,customer_id FROM ser_mart_orders WHERE id=?").bind(id).fetch_optional(&s.pool).await.map_err(|_|ApiError::internal())?;
        let Some(order)=order else { return Err(ApiError::missing("Order not found.")); };
        let access:String=order.try_get("access_token").unwrap_or_default();
        let owner:Option<i64>=order.try_get("customer_id").ok();
        let account_id=customer_id_for_token(&s.pool,token).await?;
        if access!=token && (account_id.is_none() || owner!=account_id) { return Err(ApiError::auth()); }
    }
    sqlx::query("INSERT INTO ser_mart_order_messages(order_id,sender,text,created_at) VALUES(?,?,?,?)").bind(id).bind(if seller{"seller"}else{"customer"}).bind(text.to_string()).bind(now()).execute(&s.pool).await.map_err(|_|ApiError::internal())?;
    Ok(Json(json!({"ok":true})))
}

#[tokio::main]
async fn main()->Result<(),Box<dyn std::error::Error>>{
    tracing_subscriber::fmt().with_target(false).compact().init(); install_default_drivers();
    if env::var("ADMIN_PASSWORD").map(|v|v.trim().is_empty()).unwrap_or(true) { return Err("ADMIN_PASSWORD must be set in the Render service environment".into()); }
    let url=env::var("DATABASE_URL").unwrap_or_else(|_|"sqlite://ser-mart.db?mode=rwc".into());
    let pg=url.starts_with("postgres://")||url.starts_with("postgresql://");
    let pool=AnyPoolOptions::new().max_connections(if pg{5}else{1}).connect(&url).await?; init_db(&pool,pg).await?;
    let state=AppState{pool,sessions:Arc::new(Mutex::new(HashMap::new())),login_attempts:Arc::new(Mutex::new(HashMap::new()))};
    let app=Router::new()
        .route("/",get(html_index)).route("/admin",get(html_admin)).route("/admin/",get(html_admin)).route("/seller",get(html_admin)).route("/seller/",get(html_admin))
        .route("/api/health",get(health)).route("/api/products",get(list_products)).route("/api/products/{id}",get(get_product))
        .route("/api/account/register",post(account_register)).route("/api/account/login",post(account_login))
        .route("/api/account/me",get(account_me)).route("/api/account/profile",put(account_update))
        .route("/api/account/logout",post(account_logout)).route("/api/account/orders",get(account_orders))
        .route("/api/search-trends",get(search_trends).post(record_search))
        .route("/api/images/{id}",get(get_image)).route("/api/admin/login",post(login))
        .route("/api/admin/products",get(admin_products).post(admin_create_product))
        .route("/api/admin/products/{id}",put(admin_update_product).delete(admin_delete_product))
        .route("/api/categories",get(list_categories))
        .route("/api/admin/categories",get(admin_categories).post(create_category))
        .route("/api/admin/categories/{id}",put(update_category).delete(delete_category))
        .route("/api/seller-info",get(get_seller_info)).route("/api/admin/seller-info",get(admin_seller_info).put(update_seller_info))
        .route("/api/admin/images",post(upload_image)).route("/api/admin/orders",get(admin_orders))
        .route("/api/admin/orders/{id}/status",patch(set_order_status)).route("/api/orders",post(create_order))
        .route("/api/orders/mine",get(my_order)).route("/api/orders/{id}/cancel",post(cancel_order))
        .route("/api/orders/{id}/messages",post(send_message))
        .fallback_service(ServeDir::new("public")).layer(DefaultBodyLimit::max(8*1024*1024)).layer(TraceLayer::new_for_http()).layer(middleware::from_fn(security_headers)).with_state(state);
    let port:u16=env::var("PORT").ok().and_then(|v|v.parse().ok()).unwrap_or(10000);
    let addr=SocketAddr::from(([0,0,0,0],port));
    println!("Ser mart listening on {addr}; database: {}",if pg{"PostgreSQL"}else{"local SQLite (ephemeral on Render)"});
    let listener=tokio::net::TcpListener::bind(addr).await?; axum::serve(listener,app).await?; Ok(())
}
