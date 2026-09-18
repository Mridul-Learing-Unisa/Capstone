# Shared app state and FastAPI dependencies. Loads the app config and creates
# the ProjectManager once at startup, then exposes them to routers via
# get_project_manager() / get_app_config() so nothing relies on module globals.