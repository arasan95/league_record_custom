use riot_local_auth::lcu;

fn main() {
    println!("{:#?}", lcu::try_get_credentials());
}
